import JZZ from "jzz";
// no types for jzz-midi-smf
// @ts-expect-error no types available
import jzzMidiSmf from "jzz-midi-smf";
import { StatusBarAlignment, StatusBarItem, TextEditorEdit, window } from "vscode";
import { Accidentals, LogLevel, getConfiguration, logger } from "./midi-utils";
jzzMidiSmf(JZZ);
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace MIDIIn {
  type MIDIInStateType = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    midiInPort: any;
    active: boolean;
    lastNoteTime: number; // timestamp of last note
    chordTimeout: NodeJS.Timeout | null; // timer for chord completion
  };

  export type MIDIInputConfig = {
    accidentals: Accidentals;
    relativeMode: boolean;
    chordMode: boolean;
    chordTimeWindow: number; // in milliseconds
  };

  const initialMidiInState: MIDIInStateType = {
    midiInPort: undefined,
    active: false,
    lastNoteTime: 0,
    chordTimeout: null,
  };

  let MIDIInState: MIDIInStateType = initialMidiInState;
  const statusBarItems: Record<string, StatusBarItem> = {};

  // notes that haven't been lifted up
  export const activeNotes: Set<number> = new Set();
  // chord notes that have been lifted off
  export const chordNotes: Set<number> = new Set();

  const midiInMsgProcessor = JZZ.Widget();
  // function called when a midi msg is received

  const getMIDIInputConfig = (): MIDIInputConfig => {
    const config = getConfiguration();

    const { accidentals, relativeMode, chordMode, chordTimeWindow } = config.midiInput;

    return {
      accidentals: accidentals,
      relativeMode: relativeMode,
      chordMode: chordMode,
      chordTimeWindow: chordTimeWindow,
    };
  };

  export const getAbsoluteOctavePostfix = (octaveNum: number): string => {
    if (!Number.isInteger(octaveNum) || octaveNum < 0 || octaveNum > 9) {
      throw new Error(`OctaveNumber should be an integer within [0,9]; got ${octaveNum}`);
    }
    if (octaveNum < 3) {
      return `,`.repeat(3 - octaveNum);
    } else if (octaveNum > 4) {
      return `'`.repeat(octaveNum - 1 - 3);
    } else {
      return ``;
    }
  };

  // maps midi numbers from 0-11 to the name based on the sharps/flat mode
  export const getNoteChar = (noteNum: number, accidentals?: Accidentals): string => {
    const isSharp = accidentals && accidentals === `sharps`;
    const map: Record<number, string> = {
      0: `C`,
      1: isSharp ? `^C` : `_D`,
      2: `D`,
      3: isSharp ? `^D` : `_E`,
      4: `E`,
      5: `F`,
      6: isSharp ? `^F` : `_G`,
      7: `G`,
      8: isSharp ? `^G` : `_A`,
      9: `A`,
      10: isSharp ? `^A` : `_B`,
      11: `B`,
    };

    if (!(noteNum in map)) {
      throw new Error(`NoteNumber should be a integer within [0,11]; got ${noteNum}`);
    }
    return map[noteNum];
  };

  export const midiNumberToNoteName = (note: number, accidentals?: Accidentals, relativeMode?: boolean): string => {
    if (!Number.isInteger(note) || note < 12 || note > 127) {
      throw new Error(`MIDI Note should be an integer within [12, 127], got ${note}`);
    }
    // C3(48) -> 3
    const octaveNum = Math.trunc(note / 12) - 1;

    // C3(48) -> 0
    const noteNum = note % 12;

    let noteLetter = getNoteChar(noteNum, accidentals);
    /**
     * octave <3, add ","
     * octave =3, do nothing
     * octave=4, convert noteLetter to lowercase
     * octave>4, add "'"
     */
    if (octaveNum === 4) {
      return noteLetter.toLowerCase();
    } else if (octaveNum === 3) {
      return noteLetter;
    } else {
      const octaveChar = getAbsoluteOctavePostfix(octaveNum);
      if (octaveNum >= 4) {
        noteLetter = noteLetter.toLowerCase();
      }
      return `${noteLetter}${relativeMode ? `` : octaveChar}`;
    }
  };

  export const notesToString = (notes: Set<number>, accidentals?: Accidentals, relativeMode?: boolean): string => {
    try {
      const noteArray = [...notes].sort((a, b) => a - b); // Sort notes for consistent chord ordering
      if (notes.size === 1) {
        return midiNumberToNoteName(noteArray[0], accidentals, relativeMode);
      } else if (notes.size > 1) {
        // chord
        return ` [${noteArray.map((note) => midiNumberToNoteName(note, accidentals, relativeMode)).join("")}]`;
      }
    } catch (err) {
      logger(`Error outputting note: ${err}`, LogLevel.error, false);
    }
    return ``;
  };

  export type OutputNotesFnType = (notes: Set<number>, accidentals: "sharps" | "flats", relativeMode: boolean) => void;
  // actually output the notes as text in the editor
  const outputNotes: OutputNotesFnType = (notes: Set<number>, accidentals?: Accidentals, relativeMode?: boolean) => {
    const outputString = notesToString(notes, accidentals, relativeMode);
    if (outputString.length) {
      try {
        const activeTextEditor = window.activeTextEditor;
        if (!activeTextEditor) {
          throw new Error(`No active text editor open`);
        }

        activeTextEditor.edit((editBuilder: TextEditorEdit) => {
          const position = activeTextEditor.selection.active;
          editBuilder.insert(position, outputString);
        });
      } catch (err) {
        logger(String(err), LogLevel.error, false);
      }
    }
  };
  export const processNote = (MIDINoteNumber: number, keyDown: boolean, MIDIInputConfig: MIDIInputConfig) => (outputNoteFn: OutputNotesFnType) => {
    const { accidentals, relativeMode } = MIDIInputConfig;

    if (keyDown) {
      const currentTime = Date.now();
      // Add note to active notes
      activeNotes.add(MIDINoteNumber);
      MIDIInState.lastNoteTime = currentTime;
    } else {
      // Note is released
      // If this is the first note being released after the last note was pressed
      if (activeNotes.has(MIDINoteNumber)) {
        // Clear any existing timeout
        if (MIDIInState.chordTimeout) {
          clearTimeout(MIDIInState.chordTimeout);
        }
        outputNoteFn(activeNotes, accidentals, relativeMode);

        // If we've waited longer than the chord window, output everything as a chord
        // if (timeSinceLastNote > chordTimeWindow) {
        //   // Output as a chord if we have multiple notes
        //   outputNoteFn(activeNotes, accidentals, relativeMode);
        //   activeNotes.clear();
        // } else {
        //   // Start a timeout to wait for more possible chord notes
        //   MIDIInState.chordTimeout = setTimeout(() => {
        //     if (activeNotes.size > 0) {
        //       outputNoteFn(activeNotes, accidentals, relativeMode);
        //       activeNotes.clear();
        //     }
        //   }, chordTimeWindow);
        // }

        // Remove the released note
        activeNotes.delete(MIDINoteNumber);
      }
    }
  };

  // ._receive is passed to JZZ from jzz-midi-smf
  // @ts-expect-error _receive is an internal JZZ property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  midiInMsgProcessor._receive = (msg: any) => {
    const statusByte: number = msg[0] & 0xf0; // Get only the status byte type, ignore the channel
    const MIDINoteNumber: number = msg[1];
    const velocity: number = msg[2];
    if ([0x80, 0x90].includes(statusByte) && MIDINoteNumber >= 12 && MIDINoteNumber <= 127) {
      // 0x90 indicates a keyDown event, 0 velocity check in the case of running status mode
      const keyDown: boolean = statusByte === 0x90 && velocity > 0;
      const MIDIInputConfig = getMIDIInputConfig();
      const noteProcessor = processNote(MIDINoteNumber, keyDown, MIDIInputConfig);
      noteProcessor(outputNotes);
    } else {
      logger(`Received other MIDI message: ${msg}`, LogLevel.warning, true);
    }
  };

  // start midi input
  export const startMIDIInput = async () => {
    try {
      const inputs = await getInputMIDIDevices();
      if (inputs.length === 0) {
        throw new Error(`No input MIDI devices are found.`);
      }
      const config = getConfiguration();
      MIDIInState.midiInPort = config.midiInput.input.length ? JZZ().openMidiIn(config.midiInput.input) : JZZ().openMidiIn();

      MIDIInState.midiInPort.connect(midiInMsgProcessor);
      MIDIInState.active = true;
    } catch (err) {
      logger(String(err), LogLevel.error, false);
    }
    updateMIDIStatusBarItem();
  };

  export const stopMIDIInput = async () => {
    if (MIDIInState.midiInPort) {
      MIDIInState.midiInPort.disconnect();
      MIDIInState.midiInPort.close();
    }
    MIDIInState = initialMidiInState;
    MIDIInState.active = false;
    updateMIDIStatusBarItem();
  };

  export const restartMIDIInput = async () => {
    await stopMIDIInput();
    await startMIDIInput();
  };

  const getInputMIDIDevices = async () => {
    const engine = await JZZ();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputs: string[] = engine.info().inputs.map((x: any) => x.name);
    return inputs;
  };

  // set input midi device
  export const setInputMIDIDevice = async () => {
    const inputs = await getInputMIDIDevices();
    window.showQuickPick(inputs).then((val: string | undefined) => {
      if (val) {
        const config = getConfiguration();
        config.update(`midiInput.input`, val);

        if (MIDIInState.active) {
          restartMIDIInput();
        }
      }
    });
  };

  export const initMIDIStatusBarItems = () => {
    {
      const startBtn = window.createStatusBarItem(StatusBarAlignment.Right, 2);
      startBtn.command = `abc.startMIDIInput`;
      startBtn.text = `$(circle-filled) Start MIDI Input`;
      startBtn.tooltip = `Start MIDI Input`;
      statusBarItems.start = startBtn;
    }
    {
      const stopBtn = window.createStatusBarItem(StatusBarAlignment.Right, 1);
      stopBtn.command = `abc.stopMIDIInput`;
      stopBtn.text = `$(debug-stop) Stop MIDI Input`;
      stopBtn.tooltip = `Stop MIDI Input`;
      statusBarItems.stop = stopBtn;
    }
    updateMIDIStatusBarItem();
  };

  const shouldShowStatusBarItems = (): boolean => {
    const activeTextEditor = window.activeTextEditor;
    if (activeTextEditor && activeTextEditor.document.languageId === "abc") {
      return true;
    }
    return false;
  };

  // update status bar item for midi playback
  export const updateMIDIStatusBarItem = async () => {
    if (shouldShowStatusBarItems()) {
      if (MIDIInState.active) {
        statusBarItems.start.hide();
        statusBarItems.stop.show();
      } else {
        statusBarItems.start.show();
        statusBarItems.stop.hide();
      }
    } else {
      // hide if no text editor or not LilyPond file
      Object.values(statusBarItems).forEach((x) => x.hide());
    }
  };
}
