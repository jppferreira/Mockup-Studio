#!/usr/bin/env swift
import AppKit
import Foundation

/**
 Composites a green DEV pill onto build/icon.png → build/icon-dev.png.
 Production DMG keeps build/icon.icns unchanged.
 */
let root = URL(fileURLWithPath: #filePath)
  .deletingLastPathComponent()
  .deletingLastPathComponent()
let inPath = root.appendingPathComponent("build/icon.png").path
let outPath = root.appendingPathComponent("build/icon-dev.png").path

guard let base = NSImage(contentsOfFile: inPath) else {
  fputs("failed to load \(inPath)\n", stderr)
  exit(1)
}
let size = NSSize(width: 1024, height: 1024)
let out = NSImage(size: size)
out.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
base.draw(in: NSRect(origin: .zero, size: size), from: .zero, operation: .copy, fraction: 1)

let pillW: CGFloat = 390
let pillH: CGFloat = 150
let margin: CGFloat = 70
let pill = NSRect(x: size.width - pillW - margin, y: margin, width: pillW, height: pillH)
let path = NSBezierPath(roundedRect: pill, xRadius: 48, yRadius: 48)
NSColor(calibratedRed: 0.12, green: 0.78, blue: 0.42, alpha: 1).setFill()
path.fill()
NSColor(calibratedWhite: 0, alpha: 0.35).setStroke()
path.lineWidth = 10
path.stroke()

let text = "DEV" as NSString
let attrs: [NSAttributedString.Key: Any] = [
  .font: NSFont.systemFont(ofSize: 92, weight: .heavy),
  .foregroundColor: NSColor.black,
  .kern: 4,
]
let textSize = text.size(withAttributes: attrs)
let textOrigin = NSPoint(
  x: pill.midX - textSize.width / 2,
  y: pill.midY - textSize.height / 2 - 4
)
text.draw(at: textOrigin, withAttributes: attrs)
out.unlockFocus()

guard let tiff = out.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
  fputs("failed to encode png\n", stderr)
  exit(1)
}
try png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath)")
