import JZZ from "jzz";
// no types for jzz-midi-smf
// @ts-expect-error no types available
import jzzMidiSmf from "jzz-midi-smf";
import { ConfigurationTarget, Selection, StatusBarAlignment, StatusBarItem, TextEditorEdit, commands, window } from "vscode";
import { InputAction, ControlState, InputControls, actionForMessage, createControlState, parseControllerActions, parseRestNote } from "./inputControls";
import { Accidentals, LogLevel, getConfiguration, logger } from "./midi-utils";
import { PedalGate, PedalMode, createPedalGate, isGateOpen, toggleGate, updatePedalGate, GateChange } from "./pedalGate";
jzzMidiSmf(JZZ);
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace MIDIIn {
  /** The context key that is true while the MIDI input runs, so that keys for the step input apply only then. */
  const MIDI_INPUT_ACTIVE_CONTEXT = "abc.midiInputActive";

  type MIDIInStateType = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    midiInPort: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    controlInPort: any;
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
    controlInPort: undefined,
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

  // The pedal gate, and the mode that it was made for, so that a change of the setting starts a new gate.
  let pedalGate: PedalGate = createPedalGate("off");
  let pedalGateMode: PedalMode = "off";

  const getPedalSettings = (): { mode: PedalMode; controller: number } => {
    const { pedalMode, pedalController } = getConfiguration().midiInput;
    const mode: PedalMode = pedalMode === "hold" || pedalMode === "toggle" ? pedalMode : "off";
    return { mode, controller: Number.isInteger(pedalController) ? pedalController : 64 };
  };

  // Because the setting can change while the input runs, a gate that was made for another mode is replaced.
  const syncPedalGate = (mode: PedalMode): void => {
    if (pedalGateMode !== mode) {
      pedalGate = createPedalGate(mode);
      pedalGateMode = mode;
    }
  };

  // Writes the chord that is waiting for its release window at once, because the gate is about to close on it.
  const flushPendingChord = (): void => {
    if (!MIDIInState.chordTimeout) return;
    clearTimeout(MIDIInState.chordTimeout);
    MIDIInState.chordTimeout = null;
    if (activeNotes.size > 0) {
      const { accidentals, relativeMode } = getMIDIInputConfig();
      outputNotes(activeNotes, accidentals, relativeMode);
      activeNotes.clear();
    }
  };

  const applyGateChange = (change: GateChange): void => {
    if (change === "closed") flushPendingChord();
    if (change !== "unchanged") updateMIDIStatusBarItem();
  };

  const controlState: ControlState = createControlState();

  const getInputControls = (): InputControls => {
    const { restNote, controllerActions } = getConfiguration().midiInput;
    return { restNote: parseRestNote(restNote), controllerActions: parseControllerActions(controllerActions) };
  };

  // Carries out an action of the controls. Because a rest and a bar line are written like notes, a closed gate holds them back too.
  const runInputAction = (action: InputAction, isOpen: boolean): void => {
    if ((action === "rest" || action === "barLine") && !isOpen) return;
    if (action === "rest") writeRest();
    else if (action === "barLine") writeBarLine();
    else if (action === "undo") undoInput();
    else toggleInputGate();
  };

  /**
   * Reads the messages that are not notes to write: the pedal of the gate, and the controls of the step input.
   * It serves the port of the notes and the port of a footswitch alike, and tells whether the message was a control.
   */
  const handleControlMessage = (msg: ArrayLike<number>): boolean => {
    const pedal = getPedalSettings();
    syncPedalGate(pedal.mode);
    applyGateChange(updatePedalGate(pedalGate, msg, pedal.mode, pedal.controller));
    const action = actionForMessage(msg, getInputControls(), controlState);
    if (action === undefined) return false;
    runInputAction(action, isGateOpen(pedalGate, pedal.mode));
    return true;
  };

  const midiInMsgProcessor = JZZ.Widget();
  // The widget of a second port, such as a MIDI footswitch, which sends controls and no notes to write.
  const controlMsgProcessor = JZZ.Widget();
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
        return `[${noteArray.map((note) => midiNumberToNoteName(note, accidentals, relativeMode)).join("")}]`;
      }
    } catch (err) {
      logger(`Error outputting note: ${err}`, LogLevel.error, false);
    }
    return ``;
  };

  export type OutputNotesFnType = (notes: Set<number>, accidentals: "sharps" | "flats", relativeMode: boolean) => void;

  /**
   * How the text that the input writes is left in the editor:
   * "select" selects it when the setting asks for it, so that a key can change its rhythm, and "caret" leaves only a cursor after it.
   */
  type WriteMode = "select" | "caret";

  // Because two writes that come together would both read the same cursor, and the second one would land before the first one,
  // every write waits for the one before it.
  let writeQueue: Promise<void> = Promise.resolve();

  const writeText = async (text: string, mode: WriteMode): Promise<void> => {
    try {
      const activeTextEditor = window.activeTextEditor;
      if (!activeTextEditor) {
        throw new Error(`No active text editor open`);
      }
      const position = activeTextEditor.selection.active;
      const applied = await activeTextEditor.edit((editBuilder: TextEditorEdit) => {
        editBuilder.insert(position, text);
      });
      if (!applied) return;
      const end = position.translate(0, text.length);
      // Because the next notes are written at the end of the selection, the selection moves along with the input.
      if (mode === "select" && getConfiguration().midiInput.selectLatestInput === true) {
        activeTextEditor.selection = new Selection(position, end);
      } else if (mode === "caret") {
        activeTextEditor.selection = new Selection(end, end);
      }
    } catch (err) {
      logger(String(err), LogLevel.error, false);
    }
  };

  const enqueueWrite = (text: string, mode: WriteMode): void => {
    writeQueue = writeQueue.then(() => writeText(text, mode));
  };

  // actually output the notes as text in the editor
  const outputNotes: OutputNotesFnType = (notes: Set<number>, accidentals?: Accidentals, relativeMode?: boolean) => {
    const outputString = notesToString(notes, accidentals, relativeMode);
    if (outputString.length) enqueueWrite(outputString, "select");
  };

  /** Writes a rest, which is music like a note, so it is selected and Page Up and Page Down change its length. */
  export const writeRest = (): void => {
    flushPendingChord();
    enqueueWrite("z", "select");
  };

  /** Writes a bar line, and leaves only a cursor after it. */
  export const writeBarLine = (): void => {
    flushPendingChord();
    enqueueWrite(" | ", "caret");
  };

  /** Undoes the last edit of the editor, which is the last input or the last change of a rhythm. */
  export const undoInput = (): void => {
    flushPendingChord();
    writeQueue = writeQueue.then(async () => {
      await commands.executeCommand("undo");
    });
  };

  export const processNote = (MIDINoteNumber: number, keyDown: boolean, MIDIInputConfig: MIDIInputConfig) => (outputNoteFn: OutputNotesFnType) => {
    const { accidentals, relativeMode, chordMode, chordTimeWindow } = MIDIInputConfig;

    if (keyDown) {
      // Add note to active notes. A newly-pressed note means the current gesture
      // isn't finished yet, so any pending chord finalization must be cancelled.
      activeNotes.add(MIDINoteNumber);
      MIDIInState.lastNoteTime = Date.now();
      if (MIDIInState.chordTimeout) {
        clearTimeout(MIDIInState.chordTimeout);
        MIDIInState.chordTimeout = null;
      }
      return;
    }

    // Note is released. Ignore releases for notes we weren't tracking.
    if (!activeNotes.has(MIDINoteNumber)) {
      return;
    }

    if (!chordMode) {
      // Chord grouping is disabled: output this single note as soon as it's released.
      outputNoteFn(new Set([MIDINoteNumber]), accidentals, relativeMode);
      activeNotes.delete(MIDINoteNumber);
      return;
    }

    // Chord grouping is enabled. Because a chord's notes are rarely released at the
    // exact same millisecond, we debounce: each release (re)starts the chord window,
    // and only once no more releases (or presses) happen within that window do we
    // write out the whole set of notes that were held together. Notes are deliberately
    // NOT removed from activeNotes here, since the final write needs the full chord.
    if (MIDIInState.chordTimeout) {
      clearTimeout(MIDIInState.chordTimeout);
    }
    MIDIInState.chordTimeout = setTimeout(() => {
      if (activeNotes.size > 0) {
        outputNoteFn(activeNotes, accidentals, relativeMode);
        activeNotes.clear();
      }
      MIDIInState.chordTimeout = null;
    }, chordTimeWindow);
  };

  // ._receive is passed to JZZ from jzz-midi-smf
  // @ts-expect-error _receive is an internal JZZ property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  midiInMsgProcessor._receive = (msg: any) => {
    const statusByte: number = msg[0] & 0xf0; // Get only the status byte type, ignore the channel
    const MIDINoteNumber: number = msg[1];
    const velocity: number = msg[2];
    const pedal = getPedalSettings();
    if (handleControlMessage(msg)) return;
    if ([0x80, 0x90].includes(statusByte) && MIDINoteNumber >= 12 && MIDINoteNumber <= 127) {
      // 0x90 indicates a keyDown event, 0 velocity check in the case of running status mode
      const keyDown: boolean = statusByte === 0x90 && velocity > 0;
      // Because a note that began while the gate was open must still end, only a new note is held back by a closed gate.
      if (keyDown && !isGateOpen(pedalGate, pedal.mode)) return;
      const MIDIInputConfig = getMIDIInputConfig();
      const noteProcessor = processNote(MIDINoteNumber, keyDown, MIDIInputConfig);
      noteProcessor(outputNotes);
    } else {
      logger(`Received other MIDI message: ${msg}`, LogLevel.warning, true);
    }
  };

  // @ts-expect-error _receive is an internal JZZ property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  controlMsgProcessor._receive = (msg: any) => {
    handleControlMessage(msg);
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
      // Because a footswitch is often a device of its own, its port can be opened as well, for the controls only.
      const controlInput: string = config.midiInput.controlInput ?? "";
      if (controlInput.length > 0 && controlInput !== config.midiInput.input) {
        MIDIInState.controlInPort = JZZ().openMidiIn(controlInput);
        MIDIInState.controlInPort.connect(controlMsgProcessor);
      }
      MIDIInState.active = true;
      void commands.executeCommand("setContext", MIDI_INPUT_ACTIVE_CONTEXT, true);
      // Because the pedal is assumed to be up when the input starts, a pedal mode starts with the gate closed.
      pedalGateMode = getPedalSettings().mode;
      pedalGate = createPedalGate(pedalGateMode);
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
    if (MIDIInState.controlInPort) {
      MIDIInState.controlInPort.disconnect();
      MIDIInState.controlInPort.close();
    }
    MIDIInState = { ...initialMidiInState };
    MIDIInState.active = false;
    controlState.downControllers.clear();
    void commands.executeCommand("setContext", MIDI_INPUT_ACTIVE_CONTEXT, false);
    pedalGate = createPedalGate("off");
    pedalGateMode = "off";
    updateMIDIStatusBarItem();
  };

  /**
   * Flips the gate from a command, for a footswitch that sends a key and not a MIDI message, such as a Bluetooth page turner.
   * A key has no release that an extension can see, so only the toggle mode can use it.
   */
  export const toggleInputGate = (): void => {
    const { mode } = getPedalSettings();
    if (mode !== "toggle") {
      window.showInformationMessage("Set abc.midiInput.pedalMode to toggle to switch the MIDI input with a key.");
      return;
    }
    syncPedalGate(mode);
    applyGateChange(toggleGate(pedalGate));
  };

  /**
   * Lets the user choose how the pedal acts, from a list, and saves the choice in the settings.
   */
  export const setPedalMode = async (): Promise<void> => {
    const choices: Array<{ label: PedalMode; description: string }> = [
      { label: "off", description: "The notes you play are always written" },
      { label: "hold", description: "The notes are written only while the pedal is down" },
      { label: "toggle", description: "Each press of the pedal switches the writing of notes on or off" },
    ];
    const current = getPedalSettings().mode;
    const picked = await window.showQuickPick(
      choices.map((choice) => ({ ...choice, description: choice.label === current ? `${choice.description} (current)` : choice.description })),
      { placeHolder: "How should the MIDI input pedal act?" }
    );
    if (picked === undefined) return;
    await getConfiguration().update(`midiInput.pedalMode`, picked.label, ConfigurationTarget.Global);
    syncPedalGate(picked.label);
    updateMIDIStatusBarItem();
  };

  /**
   * Switches the setting that selects the notes that the input just wrote, and says what it is now.
   */
  export const toggleSelectLatestInput = async (): Promise<void> => {
    const isOn = getConfiguration().midiInput.selectLatestInput === true;
    await getConfiguration().update(`midiInput.selectLatestInput`, !isOn, ConfigurationTarget.Global);
    window.showInformationMessage(
      !isOn ? "The MIDI input now selects the notes that it writes." : "The MIDI input no longer selects the notes that it writes."
    );
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
      const gateItem = window.createStatusBarItem(StatusBarAlignment.Right, 3);
      gateItem.command = `abc.toggleMIDIInputGate`;
      statusBarItems.gate = gateItem;
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
        const { mode } = getPedalSettings();
        if (mode === "off") {
          statusBarItems.gate.hide();
        } else {
          syncPedalGate(mode);
          const isOpen = isGateOpen(pedalGate, mode);
          statusBarItems.gate.text = isOpen ? `$(record) MIDI listening` : `$(circle-slash) MIDI waiting for the pedal`;
          statusBarItems.gate.tooltip = isOpen
            ? `Notes are written. ${mode === "hold" ? "Release" : "Press"} the pedal to stop.`
            : `Notes are not written. Press the pedal to listen.`;
          statusBarItems.gate.show();
        }
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
