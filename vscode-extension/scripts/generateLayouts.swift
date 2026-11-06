// Writes src/keyboard/layouts.ts from the keyboard layouts that macOS has installed.
//
// Because the four layers of a key (base, Shift, AltGr, AltGr and Shift) are what the keyboard view draws, this script asks the system
// what each key types, with UCKeyTranslate, and notices the dead keys (an accent that waits for a letter). The result is committed,
// so the build does not depend on macOS. Run it with: swift scripts/generateLayouts.swift > src/keyboard/layouts.ts
// and then format the result with prettier, which the repository does before a commit, so that the diff stays small.
// With the argument --list it prints the ids of the installed layouts instead.

import Carbon
import Foundation

struct KeyPosition {
    let code: UInt16
    let iso: Bool
}

// The virtual key codes of the rows of an ISO keyboard, as the QWERTY legends name them. A key flagged iso exists only on ISO keyboards.
let rows: [[KeyPosition]] = [
    [50, 18, 19, 20, 21, 23, 22, 26, 28, 25, 29, 27, 24].map { KeyPosition(code: $0, iso: false) },
    [12, 13, 14, 15, 17, 16, 32, 34, 31, 35, 33, 30].map { KeyPosition(code: $0, iso: false) },
    [0, 1, 2, 3, 5, 4, 38, 40, 37, 41, 39].map { KeyPosition(code: $0, iso: false) } + [KeyPosition(code: 42, iso: true)],
    [KeyPosition(code: 10, iso: true)] + [6, 7, 8, 9, 11, 45, 46, 43, 47, 44].map { KeyPosition(code: $0, iso: false) },
]

// The modifier states that UCKeyTranslate takes: shift is 2 and option is 8.
let states: [UInt32] = [0, 2, 8, 10]

/// The bytes of the layout. Because the pointer into them is only valid while the data lives, the data is returned and the caller keeps it.
func layoutData(for id: String) -> Data? {
    let filter = [kTISPropertyInputSourceID as String: id] as CFDictionary
    guard let list = TISCreateInputSourceList(filter, true)?.takeRetainedValue() as? [TISInputSource], let source = list.first else { return nil }
    guard let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return nil }
    return Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
    exit(1)
}

/// What a key types in one modifier state, and whether it is a dead key that waits for the next letter.
func translate(_ layout: UnsafePointer<UCKeyboardLayout>, code: UInt16, state: UInt32) -> (text: String, dead: Bool) {
    var deadKeyState: UInt32 = 0
    var length = 0
    var chars = [UniChar](repeating: 0, count: 4)
    // The keyboard type 41 is the ISO one: on an ISO keyboard the codes 10 and 50 are the ISO key and the key under Esc, and the type of the
    // keyboard that is attached would swap them for an ANSI keyboard.
    let keyboardType: UInt32 = 41
    let status = UCKeyTranslate(layout, code, UInt16(kUCKeyActionDown), state, keyboardType, 0, &deadKeyState, 4, &length, &chars)
    if status != noErr { fail("UCKeyTranslate failed with the status \(status) for the key \(code).") }
    if deadKeyState != 0 {
        // A dead key types nothing yet, so its own character is asked for with the dead keys switched off. Some layouts leave that empty,
        // and then the dead key followed by the space bar types it, once the trailing space is removed.
        var plainState: UInt32 = 0
        var plainLength = 0
        var plainChars = [UniChar](repeating: 0, count: 4)
        let plain = UCKeyTranslate(layout, code, UInt16(kUCKeyActionDown), state, keyboardType, UInt32(kUCKeyTranslateNoDeadKeysBit), &plainState, 4, &plainLength, &plainChars)
        if plain != noErr { fail("UCKeyTranslate failed with the status \(plain) for the key \(code).") }
        let own = String(utf16CodeUnits: plainChars, count: plainLength)
        if !own.isEmpty { return (own, true) }
        var spacingLength = 0
        var spacingChars = [UniChar](repeating: 0, count: 4)
        let spacing = UCKeyTranslate(layout, 49, UInt16(kUCKeyActionDown), 0, keyboardType, 0, &deadKeyState, 4, &spacingLength, &spacingChars)
        if spacing != noErr { fail("UCKeyTranslate failed with the status \(spacing) for the space bar.") }
        return (String(utf16CodeUnits: spacingChars, count: spacingLength).trimmingCharacters(in: .whitespaces), true)
    }
    return (String(utf16CodeUnits: chars, count: length), false)
}

func quoted(_ text: String) -> String {
    let escaped = text.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
    return "\"\(escaped)\""
}

func emit(name: String, id: String, layout: UnsafePointer<UCKeyboardLayout>, includeIso: Bool) {
    print("  \(name): {")
    print("    id: \(quoted(name)),")
    print("    source: \(quoted(id)),")
    print("    rows: [")
    for row in rows {
        print("      [")
        for position in row where includeIso || !position.iso {
            let cells = states.map { translate(layout, code: position.code, state: $0) }
            let texts = cells.map { quoted($0.text) }.joined(separator: ", ")
            var flags: [String] = []
            if position.iso { flags.append("iso: true") }
            if cells.contains(where: { $0.dead }) { flags.append("dead: [" + cells.map { $0.dead ? "true" : "false" }.joined(separator: ", ") + "]") }
            let tail = flags.isEmpty ? "" : ", { " + flags.joined(separator: ", ") + " }"
            print("        [\(texts)\(tail)],")
        }
        print("      ],")
    }
    print("    ],")
    print("  },")
}

if CommandLine.arguments.contains("--list") {
    let all = TISCreateInputSourceList(nil, true)?.takeRetainedValue() as? [TISInputSource] ?? []
    for source in all {
        if let raw = TISGetInputSourceProperty(source, kTISPropertyInputSourceID) {
            let id = Unmanaged<CFString>.fromOpaque(raw).takeUnretainedValue() as String
            if id.contains("keylayout") { print(id) }
        }
    }
    exit(0)
}

// The ids of the layouts to write, which the -- arguments can override: swift generateLayouts.swift qwerty=<id> bepo=<id>
var wanted: [(String, String)] = [("qwerty", "com.apple.keylayout.US"), ("bepo", "com.apple.keyboardlayout.bepo.keylayout.bépo")]
for argument in CommandLine.arguments.dropFirst() where argument.contains("=") {
    let parts = argument.split(separator: "=", maxSplits: 1).map(String.init)
    if let index = wanted.firstIndex(where: { $0.0 == parts[0] }) { wanted[index] = (parts[0], parts[1]) }
}

print("/**")
print(" * The four layers of the keys of the layouts that the keyboard view draws.")
print(" *")
print(" * Generated by scripts/generateLayouts.swift from the macOS layouts " + wanted.map { $0.1 }.joined(separator: " and ") + ". Do not edit by hand.")
print(" */")
print("")
print("/** What a key types in the base layer, with Shift, with AltGr (Option on a Mac), and with AltGr and Shift, then its flags. */")
print("export type KeyCap = [base: string, shift: string, altgr: string, altgrShift: string, flags?: { iso?: true; dead?: boolean[] }];")
print("")
print("export interface Layout {")
print("  id: \"qwerty\" | \"bepo\";")
print("  source: string;")
print("  rows: KeyCap[][];")
print("}")
print("")
print("export const LAYOUTS: Record<\"qwerty\" | \"bepo\", Layout> = {")
for (name, id) in wanted {
    guard let data = layoutData(for: id) else { fail("The layout \(id) is not installed. List the installed ones with --list.") }
    // Because the US layout is the one of an ANSI keyboard, it has no ISO-only keys.
    data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
        emit(name: name, id: id, layout: bytes.baseAddress!.assumingMemoryBound(to: UCKeyboardLayout.self), includeIso: name != "qwerty")
    }
}
print("};")
