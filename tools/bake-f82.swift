import AppKit
import CoreGraphics
import CoreText
import Foundation

// Each dimension is in pixels on the 1920 × 720 logical display.
let mainDialScale = 1.15
let auxiliaryDialScale = 1.085
let needleTailScale = 1.48
let needleTipRatio = 0.38
let auxiliaryOnly = CommandLine.arguments.contains("--auxiliary-only")
let previewsOnly = CommandLine.arguments.contains("--previews-only")
let needleShadowsOnly = CommandLine.arguments.contains("--needle-shadows-only") || previewsOnly
let tachWarningEnd = 118.0
let tachWarningRadius = 216.0

struct Dial {
    let id: String
    let center: CGPoint
    let size: Int
    let pivotY: Double
    let curve: [[Double]]
    let labels: [(Double, String)]
    let step: Double
    let unit: String
    let signal: String

    var pivot: CGPoint { CGPoint(x: Double(size) / 2, y: pivotY) }
    var small: Bool { size < 300 }
    var bezelCenter: CGPoint { small ? CGPoint(x: Double(size) / 2, y: Double(size) / 2) : pivot }
    var hubRadius: Double { small ? 22 : 31 }
    var railRadius: Double { small ? 83 : 203 }
    var needleLength: Int { small ? 92 : 195 }
}

let speed = Dial(id: "speed", center: CGPoint(x: 626, y: 351), size: 478, pivotY: 239,
                 curve: [[0, -120], [330, 120]], labels: stride(from: 0, through: 330, by: 30).map { (Double($0), String($0)) },
                 step: 10, unit: "km/h", signal: "speed")
let speedMph = Dial(id: speed.id, center: speed.center, size: speed.size, pivotY: speed.pivotY,
                    curve: [[0, -120], [200, 120]],
                    labels: stride(from: 0, through: 200, by: 20).map { (Double($0), String($0)) },
                    step: 10, unit: "mph", signal: speed.signal)
let rpm = Dial(id: "rpm", center: CGPoint(x: 1294, y: 351), size: 478, pivotY: 239,
               curve: [[0, -120], [500, -102], [1000, -79], [2000, -53], [4000, 0], [6000, 53], [8000, 106]],
               labels: (1...8).map { (Double($0 * 1000), String($0)) }, step: 500, unit: "1/min x 1000", signal: "rpm")
let dieselRpm = Dial(id: rpm.id, center: rpm.center, size: rpm.size, pivotY: rpm.pivotY,
                     curve: [[0, -120], [500, -102], [1000, -79], [6000, 106]],
                     labels: (1...6).map { (Double($0 * 1000), String($0)) },
                     step: rpm.step, unit: rpm.unit, signal: rpm.signal)
let fuel = Dial(id: "fuel", center: CGPoint(x: 252, y: 535), size: 214, pivotY: 137,
                curve: [[0, -54], [1, 54]], labels: [(0, "0"), (0.5, "1/2"), (1, "1")],
                step: 0.125, unit: "", signal: "fuel")
let oil = Dial(id: "oil", center: CGPoint(x: 1668, y: 535), size: 214, pivotY: 137,
               curve: [[70, -54], [170, 54]], labels: [(70, "70"), (120, "120"), (170, "170")],
               step: 12.5, unit: "°C", signal: "oil")
let oilFahrenheit = Dial(id: oil.id, center: oil.center, size: oil.size, pivotY: oil.pivotY,
                         curve: [[160, -54], [340, 54]], labels: [(160, "160"), (250, "250"), (340, "340")],
                         step: 22.5, unit: "°F", signal: oil.signal)
let oil50 = Dial(id: oil.id, center: oil.center, size: oil.size, pivotY: oil.pivotY,
                 curve: [[50, -54], [150, 54]], labels: [(50, "50"), (100, "100"), (150, "150")],
                 step: oil.step, unit: oil.unit, signal: oil.signal)
let oil50Fahrenheit = Dial(id: oil.id, center: oil.center, size: oil.size, pivotY: oil.pivotY,
                           curve: [[122, -54], [302, 54]], labels: [(122, "122"), (212, "212"), (302, "302")],
                           step: oilFahrenheit.step, unit: oilFahrenheit.unit, signal: oil.signal)
let oilScaleVariants: [(Dial, String)] = [(oil50, "oil-face-50-150"), (oil50Fahrenheit, "oil-face-50-150-fahrenheit")]
let dials = [speed, rpm, fuel, oil]
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ivory = color(205, 211, 219)

func color(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: r / 255, green: g / 255, blue: b / 255, alpha: a)
}

func point(_ c: CGPoint, _ radius: Double, _ degrees: Double) -> CGPoint {
    let a = degrees * .pi / 180
    return CGPoint(x: c.x + radius * sin(a), y: c.y - radius * cos(a))
}

func circle(_ c: CGPoint, _ radius: Double) -> CGRect {
    CGRect(x: c.x - radius, y: c.y - radius, width: radius * 2, height: radius * 2)
}

func polygon(_ c: CGContext, _ points: [CGPoint], _ fill: CGColor) {
    c.beginPath()
    c.addLines(between: points)
    c.closePath()
    c.setFillColor(fill)
    c.fillPath()
}

func stroke(_ c: CGContext, _ points: [CGPoint], _ ink: CGColor, _ width: Double) {
    c.beginPath()
    c.addLines(between: points)
    c.setStrokeColor(ink)
    c.setLineWidth(width)
    c.strokePath()
}

func gradientStroke(_ c: CGContext, _ points: [CGPoint], _ width: Double,
                    _ colors: [CGColor], _ from: CGPoint, _ to: CGPoint) {
    let path = CGMutablePath()
    path.addLines(between: points)
    c.saveGState()
    c.addPath(path.copy(strokingWithWidth: width, lineCap: .butt, lineJoin: .round, miterLimit: 2))
    c.clip()
    shade(c, colors, from, to)
    c.restoreGState()
}

func arc(_ center: CGPoint, _ radius: Double, _ start: Double, _ end: Double) -> [CGPoint] {
    let count = max(2, Int(ceil(abs(end - start))))
    return (0...count).map { point(center, radius, start + (end - start) * Double($0) / Double(count)) }
}

// Intersect a ray from the needle pivot with a circle around the bezel.
// On the small gauges these centres differ. The rail stays inside the rim
// while each notch remains at the angle the needle actually points to.
func railPoint(_ d: Dial, _ radius: Double, _ degrees: Double) -> CGPoint {
    let p = d.pivot, b = d.bezelCenter
    let ray = point(p, 1, degrees)
    let dx = p.x - b.x, dy = p.y - b.y
    let projection = dx * (ray.x - p.x) + dy * (ray.y - p.y)
    let distance = -projection + sqrt(projection * projection + radius * radius - dx * dx - dy * dy)
    return point(p, distance, degrees)
}

func railArc(_ d: Dial, _ radius: Double, _ start: Double, _ end: Double) -> [CGPoint] {
    let count = max(2, Int(ceil(abs(end - start))))
    return (0...count).map { railPoint(d, radius, start + (end - start) * Double($0) / Double(count)) }
}

func ellipse(_ c: CGContext, _ center: CGPoint, _ radius: Double, _ fill: CGColor) {
    c.setFillColor(fill)
    c.fillEllipse(in: circle(center, radius))
}

func label(_ c: CGContext, _ text: String, _ x: Double, _ y: Double, _ size: Double,
           ink: CGColor = ivory, font: String = "DINAlternate-Bold") {
    let face = CTFontCreateWithName(font as CFString, size, nil)
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): face,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): ink,
    ]))
    let rect = CTLineGetBoundsWithOptions(line, .useGlyphPathBounds)
    c.saveGState()
    c.translateBy(x: x - rect.midX, y: y + rect.midY)
    c.scaleBy(x: 1, y: -1)
    c.textPosition = .zero
    CTLineDraw(line, c)
    c.restoreGState()
}

let gearCapHeight = 54.0
let gearCell = CGSize(width: 56, height: 60)
let gearCharacters = Array("0123456789DMPNRS-")
let gearFont = CTFontCreateWithName("DINAlternate-Bold" as CFString, 1, nil)

func paintGearGlyph(_ c: CGContext, _ glyph: Character, _ x: Double, _ baseline: Double,
                    _ height: Double, ink: CGColor) {
    // Shape the photographed characters in units of cap height. Use the dial
    // typeface for the selector states and digits without a clear reference.
    let width: Double
    switch glyph {
    case "D", "N": width = 0.72
    case "P": width = 0.63
    case "1": width = 0.40
    default:
        label(c, String(glyph), x, baseline - height / 2, height / CTFontGetCapHeight(gearFont), ink: ink)
        return
    }
    c.saveGState()
    c.translateBy(x: x - height * width / 2, y: baseline - height)
    c.scaleBy(x: height, y: height)
    c.setFillColor(ink)
    switch glyph {
    case "D":
        c.move(to: CGPoint(x: 0, y: 0))
        c.addLine(to: CGPoint(x: 0.255, y: 0))
        c.addCurve(to: CGPoint(x: width, y: 0.49), control1: CGPoint(x: 0.57, y: 0), control2: CGPoint(x: width, y: 0.175))
        c.addCurve(to: CGPoint(x: 0.25, y: 1), control1: CGPoint(x: width, y: 0.80), control2: CGPoint(x: 0.57, y: 1))
        c.addLine(to: CGPoint(x: 0, y: 1))
        c.closePath()
        c.move(to: CGPoint(x: 0.185, y: 0.158))
        c.addLine(to: CGPoint(x: 0.255, y: 0.158))
        c.addCurve(to: CGPoint(x: 0.535, y: 0.49), control1: CGPoint(x: 0.442, y: 0.158), control2: CGPoint(x: 0.535, y: 0.278))
        c.addCurve(to: CGPoint(x: 0.253, y: 0.842), control1: CGPoint(x: 0.535, y: 0.70), control2: CGPoint(x: 0.441, y: 0.842))
        c.addLine(to: CGPoint(x: 0.185, y: 0.842))
        c.closePath()
    case "P":
        c.move(to: CGPoint(x: 0, y: 0))
        c.addLine(to: CGPoint(x: 0.277, y: 0))
        c.addCurve(to: CGPoint(x: width, y: 0.307), control1: CGPoint(x: 0.504, y: 0), control2: CGPoint(x: width, y: 0.108))
        c.addCurve(to: CGPoint(x: 0.276, y: 0.633), control1: CGPoint(x: width, y: 0.512), control2: CGPoint(x: 0.493, y: 0.633))
        c.addLine(to: CGPoint(x: 0.189, y: 0.633))
        c.addLine(to: CGPoint(x: 0.189, y: 1))
        c.addLine(to: CGPoint(x: 0, y: 1))
        c.closePath()
        c.move(to: CGPoint(x: 0.189, y: 0.156))
        c.addLine(to: CGPoint(x: 0.272, y: 0.156))
        c.addCurve(to: CGPoint(x: 0.448, y: 0.309), control1: CGPoint(x: 0.38, y: 0.156), control2: CGPoint(x: 0.448, y: 0.201))
        c.addCurve(to: CGPoint(x: 0.27, y: 0.476), control1: CGPoint(x: 0.448, y: 0.421), control2: CGPoint(x: 0.382, y: 0.476))
        c.addLine(to: CGPoint(x: 0.189, y: 0.476))
        c.closePath()
    case "N":
        c.addLines(between: [(0.0, 1.0), (0, 0), (0.176, 0), (0.55, 0.666), (0.55, 0),
                             (width, 0), (width, 1), (0.549, 1), (0.174, 0.337), (0.174, 1)]
            .map { CGPoint(x: $0.0, y: $0.1) })
        c.closePath()
    default: // The 1 has a short diagonal flag and no foot.
        c.addLines(between: [(0.0, 0.202), (0.233, 0), (width, 0), (width, 1),
                             (0.181, 1), (0.181, 0.27), (0.081, 0.351)]
            .map { CGPoint(x: $0.0, y: $0.1) })
        c.closePath()
    }
    c.drawPath(using: .eoFill)
    c.restoreGState()
}

func angle(_ dial: Dial, _ value: Double) -> Double {
    let marks = dial.curve
    if value <= marks[0][0] { return marks[0][1] }
    for i in 1..<marks.count where value <= marks[i][0] {
        let left = marks[i - 1], right = marks[i]
        return left[1] + (right[1] - left[1]) * (value - left[0]) / (right[0] - left[0])
    }
    return marks.last![1]
}

func shade(_ c: CGContext, _ colors: [CGColor], _ from: CGPoint, _ to: CGPoint) {
    let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: nil)!
    c.drawLinearGradient(gradient, start: from, end: to, options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
}

func radialShade(_ c: CGContext, _ colors: [CGColor], _ at: CGPoint, _ radius: Double) {
    let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: nil)!
    c.drawRadialGradient(gradient, startCenter: at, startRadius: 0, endCenter: at, endRadius: radius,
                         options: [.drawsAfterEndLocation])
}

func badge(_ c: CGContext, _ x: Double, _ y: Double, night: Bool, vividDay: Bool = true) {
    // Traced from the supplied metric cluster photo. All four shapes share a baseline.
    let scale = 1.38
    c.saveGState()
    c.translateBy(x: x - 55 * scale / 2, y: y)
    c.scaleBy(x: scale, y: scale)
    let stripes = night ? [color(174, 232, 252), color(20, 186, 240), color(250, 107, 83)]
                        : vividDay ? [color(63, 153, 208), color(43, 83, 153), color(191, 57, 49)]
                                   : [color(51, 77, 106), color(42, 55, 89), color(98, 47, 43)]
    for (index, ink) in stripes.enumerated() {
        let left = Double(index) * 8.4
        polygon(c, [CGPoint(x: left + 10.5, y: 0), CGPoint(x: left + 17.7, y: 0),
                    CGPoint(x: left + 7.2, y: 20), CGPoint(x: left, y: 20)], ink)
    }
    let mark = [(24.7, 20.0), (35.8, 0), (44.4, 0), (44.4, 5.5), (48.2, 0), (55, 0),
                (55, 20), (47.4, 20), (47.4, 13.8), (44, 20), (37, 20), (37, 13.8), (33.5, 20)]
    polygon(c, mark.map { CGPoint(x: $0.0, y: $0.1) },
            night ? color(247, 253, 253) : vividDay ? color(196, 201, 205) : color(105, 107, 109))
    c.restoreGState()
}

func fuelIcon(_ c: CGContext, _ x: Double, _ y: Double, night: Bool, arrow: Bool = true) {
    let white = night ? color(238, 249, 253) : color(199, 208, 217)
    c.setFillColor(white)
    c.beginPath()
    c.addPath(CGPath(roundedRect: CGRect(x: x - 8, y: y - 11, width: 16, height: 22),
                     cornerWidth: 1.6, cornerHeight: 1.6, transform: nil))
    c.addRect(CGRect(x: x - 5.4, y: y - 8.1, width: 10.8, height: 5))
    c.drawPath(using: .eoFill)
    c.saveGState()
    c.setStrokeColor(white)
    c.setLineWidth(1.7)
    c.setLineCap(.round)
    c.beginPath()
    c.move(to: CGPoint(x: x + 7, y: y + 2))
    c.addQuadCurve(to: CGPoint(x: x + 10, y: y + 5), control: CGPoint(x: x + 10, y: y + 2))
    c.addCurve(to: CGPoint(x: x + 13.3, y: y + 4), control1: CGPoint(x: x + 10, y: y + 9),
               control2: CGPoint(x: x + 13.3, y: y + 9))
    c.addLine(to: CGPoint(x: x + 13.3, y: y - 2))
    c.addQuadCurve(to: CGPoint(x: x + 9.9, y: y - 8.5), control: CGPoint(x: x + 13.3, y: y - 5.2))
    c.strokePath()
    c.restoreGState()
    if arrow {
        polygon(c, [CGPoint(x: x + 16.5, y: y - 4.2), CGPoint(x: x + 23, y: y),
                    CGPoint(x: x + 16.5, y: y + 4.2)], white)
    }
}

func oilTemperatureIcon(_ c: CGContext, _ x: Double, _ baseline: Double, night: Bool) {
    let ink = night ? color(247, 242, 239) : color(199, 208, 217)
    c.saveGState()
    c.translateBy(x: x, y: baseline)
    c.setLineCap(.round)
    c.setLineJoin(.round)
    // The metric F82 combines the oil can and the graduated thermometer.
    let can = [(-15.5, -10.3), (-13.1, -12.4), (-8.9, -8.1), (-1.2, -8.4),
               (3.6, -6.4), (14.1, -10.0), (16.4, -8.9), (13.2, -8.8),
               (5.2, 0.0), (-8.3, 0), (-11.0, -5.2), (-15.5, -10.3)]
    stroke(c, can.map { CGPoint(x: $0.0, y: $0.1) }, ink, 1.6)
    stroke(c, [CGPoint(x: -5.1, y: -10.6), CGPoint(x: -1.3, y: -10.6)], ink, 1.5)
    ellipse(c, CGPoint(x: 16.3, y: -2.7), 1.15, ink)

    let stem = 4.8
    stroke(c, [CGPoint(x: stem, y: -29), CGPoint(x: stem, y: -12.7)], ink, 2)
    for y in [-25.0, -21.5, -18.0] {
        stroke(c, [CGPoint(x: stem, y: y), CGPoint(x: stem + 4, y: y)], ink, 1.5)
    }
    ellipse(c, CGPoint(x: stem, y: -12.7), 2.0, ink)
    c.restoreGState()
}

func dialContour(_ d: Dial, _ bezel: CGPoint, _ radius: Double) -> [CGPoint] {
    if d.small { return arc(bezel, radius, 0, 360) }
    // The large rings open into the cluster surround at the bottom.
    return arc(bezel, radius, -132, 132)
}

func steppedRail(_ d: Dial, _ angles: (Double, Double), _ major: [Double]) -> [CGPoint] {
    let r = d.railRadius
    let half = d.small ? 1.15 : 0.86
    let depth = d.small ? 8.0 : 13.0
    var path: [CGPoint] = []
    var from = angles.0
    for mark in major {
        let theta = angle(d, mark)
        let start = theta - half, end = theta + half
        path += railArc(d, r, from, start)
        // The reference has a continuous rail with a narrow recess at each
        // numbered mark. Trace the two walls and the floor of that recess.
        path.append(railPoint(d, r - depth, start + 0.12))
        path += railArc(d, r - depth, start + 0.12, end - 0.12)
        path.append(railPoint(d, r, end))
        from = end
    }
    path += railArc(d, r, from, angles.1)
    return path
}

func hub(_ c: CGContext, _ p: CGPoint, _ r: Double, small: Bool, night: Bool, lightFromRight: Bool) {
    let dayLightX = lightFromRight ? 1.0 : -1.0
    if night {
        radialShade(c, [color(4, 5, 6, 0.78), color(4, 5, 6, small ? 0.54 : 0.45), color(4, 5, 6, 0)],
                    CGPoint(x: p.x + 3, y: p.y + 4), r + 10)
    } else {
        // The cap sits close to the face. Its contact shadow is darkest at the rim.
        let shadowCenter = CGPoint(x: p.x - r * 0.045 * dayLightX, y: p.y + r * 0.07)
        let shadowColors = [color(3, 5, 7, 0.9), color(3, 5, 7, 0.76),
                            color(3, 5, 7, small ? 0.41 : 0.24), color(3, 5, 7, 0)]
        let shadow = CGGradient(colorsSpace: space, colors: shadowColors as CFArray, locations: [0, 0.26, 0.60, 1])!
        c.drawRadialGradient(shadow, startCenter: shadowCenter, startRadius: r * 0.9,
                             endCenter: shadowCenter, endRadius: r * (small ? 1.30 : 1.18), options: [.drawsBeforeStartLocation])
    }
    // The opaque hub hides the centre of the backlight. Its narrow shoulder
    // catches the light, then it falls off into the matte dial.
    if night {
        let backlight = small
            ? CGPoint(x: p.x - dayLightX * r * 0.10, y: p.y + r * 0.025)
            : CGPoint(x: p.x + r * 0.025, y: p.y + r * 0.038)
        let glow = small
            ? [color(225, 227, 231, 0.50), color(225, 227, 231, 0.50), color(218, 221, 225, 0.38),
               color(198, 202, 207, 0.22), color(173, 177, 183, 0.09), color(150, 154, 160, 0)]
            : [color(212, 222, 240, 0.48), color(212, 222, 240, 0.48), color(206, 216, 233, 0.37),
                    color(185, 194, 210, 0.23), color(160, 170, 185, 0.11), color(143, 151, 162, 0)]
        let falloff = CGGradient(colorsSpace: space, colors: glow as CFArray, locations: [0, 0.56, 0.65, 0.73, 0.81, 1])!
        c.drawRadialGradient(falloff, startCenter: backlight, startRadius: 0, endCenter: backlight, endRadius: r * (small ? 1.55 : 1.76), options: [])
    }
    c.saveGState()
    c.addEllipse(in: circle(p, r))
    c.clip()
    shade(c, night ? [color(13, 15, 18), color(5, 7, 9), color(3, 4, 6), color(8, 10, 13)]
                   : [color(10, 13, 17), color(5, 7, 10), color(4, 5, 8), color(8, 10, 13)],
          CGPoint(x: p.x - r, y: p.y - r * 0.65), CGPoint(x: p.x + r, y: p.y + r))
    c.restoreGState()
    c.saveGState()
    c.addEllipse(in: circle(p, r - (night ? 2.6 : r * 0.13)))
    c.clip()
    radialShade(c, night ? [color(13, 15, 18), color(6, 8, 10), color(3, 4, 5)]
                         : [color(38, 42, 48), color(26, 29, 34), color(14, 16, 19)],
                CGPoint(x: p.x + r * (night ? -0.30 : dayLightX * 0.28), y: p.y - r * (night ? 0.38 : 0.46)), r * 1.38)
    c.restoreGState()
    stroke(c, arc(p, r - 0.8, night ? -76 : -56, night ? 18 : 24),
           night ? color(113, 125, 140, 0.12) : color(128, 136, 147, 0.11), 0.95)
    if small && !night {
        let start = lightFromRight ? 8.0 : -82.0
        let end = lightFromRight ? 82.0 : -8.0
        let fade = color(151, 159, 170, 0)
        gradientStroke(c, arc(p, r - 1.1, start, end), 1.05,
                       [fade, color(151, 159, 170, 0.25), fade],
                       point(p, r - 1.1, start), point(p, r - 1.1, end))
    }

}

func traceDialFloor(_ c: CGContext, _ p: CGPoint, _ end: CGPoint) {
    c.addLine(to: CGPoint(x: p.x + 61, y: p.y + 77))
    c.addQuadCurve(to: CGPoint(x: p.x + 49, y: p.y + 73), control: CGPoint(x: p.x + 55, y: p.y + 73))
    c.addLine(to: CGPoint(x: p.x - 49, y: p.y + 73))
    c.addQuadCurve(to: CGPoint(x: p.x - 61, y: p.y + 77), control: CGPoint(x: p.x - 55, y: p.y + 73))
    c.addLine(to: end)
}

func paintDialStep(_ c: CGContext, _ p: CGPoint, at edge: Double, inward: Bool, night: Bool, balancedDay: Bool = true) {
    // The inner and outer walls face opposite directions under the same upper-right light.
    let shadowSide = inward ? 52.0 : -128.0
    let dark = point(p, edge, shadowSide), lit = point(p, edge, shadowSide + 180)
    func ramp(_ width: Double, stops: [CGFloat], coverage: [CGFloat], tones: [CGColor]) {
        let inner = inward ? edge - width : edge
        let outer = inward ? edge : edge + width
        let locations = inward ? stops.reversed().map { 1 - $0 } : stops
        let opacity = inward ? Array(coverage.reversed()) : coverage
        let mask = opacity.map { color(255, 255, 255, $0) }
        let falloff = CGGradient(colorsSpace: space, colors: mask as CFArray, locations: locations)!
        c.saveGState()
        c.addEllipse(in: circle(p, outer))
        c.addEllipse(in: circle(p, inner))
        c.clip(using: .evenOdd)
        c.beginTransparencyLayer(auxiliaryInfo: nil)
        shade(c, tones, dark, lit)
        c.setBlendMode(.destinationIn)
        c.drawRadialGradient(falloff, startCenter: p, startRadius: inner,
                             endCenter: p, endRadius: outer, options: [])
        c.endTransparencyLayer()
        c.restoreGState()
    }

    // Day's shallow moulded steps need less edge contrast than the lit Night face.
    let shallow = !night && balancedDay
    ramp(inward ? (shallow ? 5.4 : 7.2) : (shallow ? 6.2 : 8.6),
         stops: [0, 0.18, 0.36, 0.69, 1], coverage: [0.57, 1, 0.68, 0.20, 0],
         tones: [color(2, 4, 7, night ? 0.48 : (shallow ? 0.28 : 0.47)),
                 color(2, 4, 7, night ? 0.20 : (shallow ? 0.14 : 0.23)),
                 color(2, 4, 7, night ? 0.09 : (shallow ? 0.065 : 0.11))])
    // The lit bevel uses a restrained reflection across the wall of the same material.
    let wallLight = night ? color(96, 96, 100, 0.14) : color(115, 122, 131, shallow ? 0.16 : 0.29)
    ramp(inward ? (shallow ? 2.4 : 3.1) : (shallow ? 3.0 : 4.1),
         stops: [0, 0.28, 0.61, 1], coverage: [0, 1, 0.66, 0],
         tones: [color(100, 108, 117, 0), color(100, 108, 117, night ? 0.025 : (shallow ? 0.030 : 0.055)), wallLight])
}

func paintDialLevels(_ c: CGContext, _ d: Dial, night: Bool, balancedDay: Bool = true) {
    paintDialStep(c, d.pivot, at: 116, inward: true, night: night, balancedDay: balancedDay)
    paintDialStep(c, d.pivot, at: d.railRadius - 17, inward: false, night: night, balancedDay: balancedDay)
}

func paintDaySurfaceLighting(_ c: CGContext, _ d: Dial, balanced: Bool = true) {
    // One charcoal material: the raised number shelf receives a little more
    // light than the centre well and outer tick trough. Broad directional light
    // describes the planes without a uniformly dark ring around the shelf.
    let p = d.pivot
    let dark = CGPoint(x: p.x - 170, y: p.y + 155)
    let light = CGPoint(x: p.x + 170, y: p.y - 155)
    func plane(_ inner: Double, _ outer: Double, _ tones: [CGFloat]) {
        c.saveGState()
        c.addEllipse(in: circle(p, outer))
        if inner > 0 { c.addEllipse(in: circle(p, inner)) }
        c.clip(using: .evenOdd)
        c.beginTransparencyLayer(auxiliaryInfo: nil)
        shade(c, tones.map { color(0, 0, 0, $0) }, dark, light)
        c.setBlendMode(.destinationIn)
        let locations: [CGFloat] = inner > 0 ? [0, 0.10, 0.90, 1] : [0, 0.94, 1]
        let coverage: [CGFloat] = inner > 0 ? [0, 1, 1, 0] : [1, 1, 0]
        let fade = CGGradient(colorsSpace: space,
                              colors: coverage.map { color(255, 255, 255, $0) } as CFArray,
                              locations: locations)!
        c.drawRadialGradient(fade, startCenter: p, startRadius: inner,
                             endCenter: p, endRadius: outer, options: [])
        c.endTransparencyLayer()
        c.restoreGState()
    }
    plane(0, 116, balanced ? [0.065, 0.020, 0] : [0.045, 0.018, 0.006])
    plane(d.railRadius - 17, Double(d.size) / 2 - 10,
          balanced ? [0.080, 0.030, 0] : [0.058, 0.033, 0.013])
}

func paintAuxRecess(_ c: CGContext, _ bezel: CGPoint, _ radius: Double, night: Bool) {
    // Shift the falloff away from the light so the upper-right wall casts inward.
    let center = CGPoint(x: bezel.x - 2.2, y: bezel.y + 1.6)
    let tones = [color(3, 5, 8, 0), color(3, 5, 8, 0.07), color(3, 5, 8, night ? 0.36 : 0.43)]
    let shade = CGGradient(colorsSpace: space, colors: tones as CFArray, locations: [0, 0.50, 1])!
    c.drawRadialGradient(shade, startCenter: center, startRadius: radius - 11, endCenter: center,
                         endRadius: radius - 1, options: [.drawsAfterEndLocation])
}

func paintBezelShadow(_ c: CGContext, _ outline: CGPath, small: Bool, night: Bool) {
    // Light from the upper right gives the housing a wider shadow to the left.
    let castOffset = night ? CGSize(width: small ? -5 : -9, height: small ? -3 : -5)
                           : CGSize(width: small ? -3 : -5, height: small ? -2 : -3)
    let contactOffset = night ? CGSize(width: -1.5, height: -1.5) : CGSize(width: -0.9, height: -1.0)
    let castBlur = night ? (small ? 7.0 : 10.0) : (small ? 3.4 : 5.5)
    let contactBlur = night ? (small ? 3.0 : 4.4) : (small ? 1.9 : 2.7)
    for (offset, blur, opacity) in [(castOffset, castBlur, night ? 0.65 : (small ? 0.50 : 0.28)),
                                     (contactOffset, contactBlur, night ? 0.71 : (small ? 0.68 : 0.48))] {
        c.saveGState()
        c.setShadow(offset: offset, blur: blur, color: color(0, 0, 0, opacity))
        c.setFillColor(color(8, 10, 13))
        c.addPath(outline)
        c.fillPath()
        c.restoreGState()
    }
}

func paintDayRimCast(_ c: CGContext, _ d: Dial, _ radius: Double) {
    let center = d.bezelCenter
    let (start, end) = d.small ? (195.0, 282.0) : (-135.0, -61.0)
    let inner = radius + (d.small ? 4.1 : 5.0)
    let outer = radius + (d.small ? 9.4 : 11.7)
    let tones = [color(0, 0, 0, 0.60), color(0, 0, 0, 0.42), color(0, 0, 0, 0.17), color(0, 0, 0, 0)]
    let falloff = CGGradient(colorsSpace: space, colors: tones as CFArray, locations: [0, 0.20, 0.52, 1])!
    let mask = [color(255, 255, 255, 0), color(255, 255, 255, 1), color(255, 255, 255, 0.40), color(255, 255, 255, 0)]
    let stops: [CGFloat] = d.small ? [0, 0.48, 0.72, 1] : [0, 0.25, 0.60, 1]
    let direction = CGGradient(colorsSpace: space, colors: mask as CFArray, locations: stops)!

    // The upper-right light casts toward the lower left, outside the housing.
    c.saveGState()
    c.beginPath()
    c.addLines(between: arc(center, outer, start, end) + arc(center, inner, end, start))
    c.closePath()
    c.clip()
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    c.drawRadialGradient(falloff, startCenter: center, startRadius: inner,
                         endCenter: center, endRadius: outer, options: [])
    c.saveGState()
    c.setBlendMode(.destinationIn)
    c.drawLinearGradient(direction, start: point(center, outer, start), end: point(center, outer, end),
                         options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    c.restoreGState()
    c.endTransparencyLayer()
    c.restoreGState()
}

func paintMetalRim(_ c: CGContext, _ d: Dial, _ radius: Double, night: Bool, polishedDay: Bool = true,
                   depthDay: Bool = false) {
    let center = d.bezelCenter
    let dimensional = depthDay && !night && polishedDay
    let halfWidth = d.small ? 1.75 : 1.95
    let inner = radius - halfWidth
    let steppedInner = radius - (d.small ? 5.5 : 6.8)
    let outer = radius + halfWidth
    let inside: [CGPoint]
    if d.small {
        inside = arc(center, inner, 360, 229)
            + arc(center, steppedInner, 229, 137)
            + arc(center, inner, 137, 0)
    } else {
        inside = arc(center, steppedInner, 132, 118)
            + arc(center, inner, 118, -118)
            + arc(center, steppedInner, -118, -132)
    }
    let steel = night
        ? (d.small ? [color(59, 63, 69), color(28, 31, 35), color(52, 57, 64), color(113, 121, 131)]
                   : [color(45, 46, 49), color(23, 24, 27), color(35, 30, 26), color(101, 78, 55)])
        : [color(147, 154, 163), color(121, 130, 141), color(100, 108, 119), color(146, 155, 165)]
    c.saveGState()
    c.beginPath()
    c.addLines(between: dialContour(d, center, outer) + inside)
    c.closePath()
    c.clip()
    if !night && polishedDay {
        // One continuous steel reflection across the entire ring and width
        // steps. Contrast gives polish without turning the metal into white
        // printing or separately shading the thicker end pieces.
        // Narrow reflected windows interrupt darker steel. The same field
        // crosses the wider lower sections; they are not separate inserts.
        let reflection = dimensional
            ? [color(138, 146, 156), color(165, 173, 182), color(216, 223, 230),
               color(160, 168, 178), color(85, 94, 105), color(120, 130, 142),
               color(165, 174, 184), color(215, 222, 229), color(160, 170, 181), color(138, 148, 160)]
            : [color(132, 140, 151), color(174, 182, 191), color(91, 100, 112),
               color(115, 125, 137), color(177, 185, 194), color(135, 145, 157)]
        let locations: [CGFloat] = dimensional
            ? [0, 0.145, 0.18, 0.215, 0.355, 0.585, 0.755, 0.79, 0.825, 1]
            : [0, 0.18, 0.36, 0.59, 0.79, 1]
        let gradient = CGGradient(colorsSpace: space, colors: reflection as CFArray,
                                  locations: locations)!
        c.drawLinearGradient(gradient, start: CGPoint(x: Double(d.size), y: 0),
                             end: CGPoint(x: 0, y: Double(d.size) * 0.90),
                             options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    } else {
        shade(c, steel, .zero, CGPoint(x: Double(d.size) * 0.09, y: Double(d.size) * 0.88))
    }
    if d.small {
        let outside = d.id == "fuel" ? -90.0 : 90.0
        let wall = radius - 0.85
        let fade = color(42, 49, 58, 0)
        gradientStroke(c, arc(center, wall, outside - 60, outside + 60), 1.35,
                       [fade, color(42, 49, 58, night ? 0.24 : 0.52), fade],
                       point(center, wall, outside - 60), point(center, wall, outside + 60))
    }
    if night && d.small {
        // A narrow cool reflection belongs to the same steel surface through
        // the bottom width step; it is not a separately shaded notch insert.
        let lip = radius + 0.70
        let fade = color(225, 232, 241, 0)
        for (start, end, strength) in [(-42.0, 78.0, 0.35), (115.0, 244.0, 0.48)] {
            gradientStroke(c, arc(center, lip, start, end), 0.82,
                           [fade, color(225, 232, 241, strength), fade],
                           point(center, lip, start), point(center, lip, end))
        }
    }
    if !night {
        // Reflections follow the outer lip across each step in the same metal.
        let lower = d.small ? [(122.0, 239.0, dimensional ? 0.56 : 0.49)]
                            : [(-144.0, -100.0, dimensional ? 0.42 : 0.29),
                               (100.0, 144.0, dimensional ? 0.48 : 0.34)]
        let reflections = d.small
            ? [(-20.0, 100.0, dimensional ? 0.70 : 0.62), (-103.0, -37.0, 0.20)] + lower
            : [(-20.0, 100.0, dimensional ? 0.60 : 0.49),
               (-103.0, -37.0, dimensional ? 0.16 : 0.12)] + lower
        let lip = radius + (d.small ? 0.75 : 0.95)
        let fade = dimensional ? color(233, 239, 245, 0) : color(210, 219, 229, 0)
        for (start, end, strength) in reflections {
            let highlight = dimensional ? color(233, 239, 245, strength) : color(210, 219, 229, strength)
            gradientStroke(c, arc(center, lip, start, end),
                           d.small ? (dimensional ? 0.85 : 1.0) : (dimensional ? 1.0 : 1.15),
                           [fade, highlight, fade],
                           point(center, lip, start), point(center, lip, end))
        }
    }
    c.restoreGState()
}

func paintDayInnerRim(_ c: CGContext, _ d: Dial, _ radius: Double, shadowScale: CGFloat = 1.30) {
    let bezel = d.bezelCenter
    let lipInner = radius - (d.small ? 1.75 : 1.95)
    let steppedInner = radius - (d.small ? 5.5 : 6.8)
    let toe = d.small ? 93.0 : 218.5
    // Seen from the driver's centreline, the far outer wall of each small cup
    // is more visible. This shifts the opening, not the needle or printed scale.
    let viewOffset = d.small ? (d.id == "fuel" ? 1.5 : -1.5) : 0
    let opening = CGPoint(x: bezel.x + viewOffset, y: bezel.y)
    let outerContour: [CGPoint]
    if d.small {
        outerContour = arc(bezel, lipInner, 0, 137)
            + arc(bezel, steppedInner, 137, 229)
            + arc(bezel, lipInner, 229, 360)
    } else {
        outerContour = arc(bezel, steppedInner, -132, -118)
            + arc(bezel, lipInner, -118, 118)
            + arc(bezel, steppedInner, 118, 132)
    }
    let dark = point(bezel, radius, 52), light = point(bezel, radius, -128)
    c.saveGState()
    c.addLines(between: outerContour + dialContour(d, opening, toe).reversed())
    c.closePath()
    c.clip()
    let steel = [color(27, 32, 39), color(36, 42, 50), color(52, 60, 69), color(37, 44, 52)]
    let reflection = CGGradient(colorsSpace: space, colors: steel as CFArray,
                                locations: [0, 0.43, 0.72, 1])!
    c.drawLinearGradient(reflection, start: dark, end: light,
                         options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    // The wall rolls into a close dark foot rather than a flat black gap.
    c.setBlendMode(.multiply)
    let roll = CGGradient(colorsSpace: space,
                          colors: [color(186, 186, 186), color(226, 226, 226),
                                   color(255, 255, 255), color(237, 237, 237)] as CFArray,
                          locations: [0, 0.12, 0.46, 1])!
    c.drawRadialGradient(roll, startCenter: opening, startRadius: toe,
                         endCenter: opening, endRadius: lipInner + abs(viewOffset),
                         options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    c.setBlendMode(.normal)
    let ribbon = toe + (lipInner - toe) * 0.62
    let fade = color(132, 142, 153, 0)
    for (start, end, strength) in [(-106.0, -22.0, 0.24), (73.0, 113.0, 0.13)] {
        gradientStroke(c, arc(opening, ribbon, start, end), d.small ? 0.75 : 0.95,
                       [fade, color(132, 142, 153, strength), fade],
                       point(opening, ribbon, start), point(opening, ribbon, end))
    }
    c.restoreGState()

    func footShadow(_ width: Double, _ opacity: [CGFloat]) {
        c.saveGState()
        c.addLines(between: dialContour(d, opening, toe)
                   + dialContour(d, opening, toe - width).reversed())
        c.closePath()
        c.clip()
        c.beginTransparencyLayer(auxiliaryInfo: nil)
        // The upper-right wall intercepts the upper-right light, casting inward
        // toward the lower left. Viewing parallax never reverses this lighting.
        shade(c, opacity.map { color(1, 3, 6, $0 * shadowScale) }, dark, light)
        c.setBlendMode(.destinationIn)
        let mask = CGGradient(colorsSpace: space,
                              colors: [color(255, 255, 255, 0), color(255, 255, 255, 0.10),
                                       color(255, 255, 255, 0.35), color(255, 255, 255)] as CFArray,
                              locations: [0, 0.25, 0.62, 1])!
        c.drawRadialGradient(mask, startCenter: opening, startRadius: toe - width,
                             endCenter: opening, endRadius: toe, options: [])
        c.endTransparencyLayer()
        c.restoreGState()
    }
    footShadow(d.small ? 2.8 : 4.0, [0.16, 0.055, 0])
    footShadow(d.small ? 0.65 : 0.85, [0.22, 0.09, 0.025])
}

func paintFace(_ c: CGContext, _ d: Dial, night: Bool, surfaceLighting: Bool = true,
               balancedDay: Bool = true, dimensionalDayRim: Bool = true, innerRimShadowScale: CGFloat = 1.30) {
    let n = Double(d.size), p = d.pivot
    let warmSide = d.id == "rpm" || d.id == "oil"
    // The closed auxiliary cups have a different centre from their lower hubs.
    let bezel = d.bezelCenter
    let radius = n / 2 - 5
    let trim = dialContour(d, bezel, radius)
    if d.small {
        c.addEllipse(in: circle(bezel, radius))
    } else {
        c.addLines(between: trim)
        traceDialFloor(c, p, trim[0])
        c.closePath()
    }
    let outline = c.path!
    c.beginPath()
    if !night { paintDayRimCast(c, d, radius) }
    paintBezelShadow(c, outline, small: d.small, night: night)
    c.saveGState()
    c.addPath(outline)
    c.clip()
    if night {
        let satin = warmSide ? [color(21, 16, 15), color(12, 9, 9), color(5, 4, 5)]
                             : [color(14, 15, 17), color(8, 9, 11), color(4, 5, 7)]
        radialShade(c, satin, CGPoint(x: n * 0.49, y: n * 0.64), n * 0.72)
    } else {
        // The dials sit under glass. The cool reflection brightens one side of
        // the satin charcoal face and falls off toward the bezel wall.
        let graphite = warmSide ? [color(44, 48, 53), color(36, 41, 47), color(23, 28, 35)]
                                : [color(41, 45, 50), color(33, 38, 44), color(21, 26, 33)]
        radialShade(c, graphite, CGPoint(x: n * (warmSide ? 0.61 : 0.52), y: n * 0.54), n * 0.79)
        if !d.small && !dimensionalDayRim {
            let edgeFade = CGGradient(colorsSpace: space, colors: [color(5, 8, 12, 0), color(5, 8, 12, 0.14)] as CFArray,
                                      locations: nil)!
            c.drawRadialGradient(edgeFade, startCenter: bezel, startRadius: radius - 5.5,
                                 endCenter: bezel, endRadius: radius, options: [])
        }
    }
    if !night && dimensionalDayRim { paintDayInnerRim(c, d, radius, shadowScale: innerRimShadowScale) }
    if d.small && (night || !dimensionalDayRim) {
        paintAuxRecess(c, bezel, radius, night: night)
    } else if !d.small {
        if !night && surfaceLighting { paintDaySurfaceLighting(c, d, balanced: balancedDay) }
        paintDialLevels(c, d, night: night, balancedDay: balancedDay)
        let floorShadow = night ? [(6.0, color(5, 8, 12, 0.35)), (2.4, color(5, 8, 12, 0.78))]
                                : [(2.9, color(5, 8, 12, 0.22)), (1.35, color(5, 8, 12, 0.57))]
        for (width, ink) in floorShadow {
            c.beginPath()
            c.move(to: trim.last!)
            traceDialFloor(c, p, trim[0])
            c.setStrokeColor(ink)
            c.setLineWidth(width)
            c.strokePath()
        }
    }
    c.restoreGState()

    let housing = night ? [color(12, 14, 18), color(4, 5, 7), color(15, 13, 12)]
                        : [color(20, 24, 32), color(5, 7, 11), color(14, 18, 25)]
    let housingEdge = dialContour(d, bezel, radius + (d.small ? 1.5 : 1.8))
    let housingWidth = d.small ? 7.0 : 8.2
    gradientStroke(c, housingEdge, housingWidth, housing,
                   CGPoint(x: n, y: 0), CGPoint(x: 0, y: n * 0.8))
    paintMetalRim(c, d, radius, night: night, depthDay: dimensionalDayRim)
    if night {
        let coolGlint = d.small ? (-54.0, 33.0) : (-59.0, 18.0)
        gradientStroke(c, arc(bezel, radius - 0.7, coolGlint.0, coolGlint.1), 1.3,
                       [color(100, 117, 142, 0), color(118, 132, 153, 0.29), color(100, 117, 142, 0)],
                       point(bezel, radius, coolGlint.0), point(bezel, radius, coolGlint.1))
    }

    paintDialMarkings(c, d, night: night)
    if d.id == "speed" { badge(c, p.x, p.y + 145, night: night) }
    hub(c, p, d.hubRadius, small: d.small, night: night, lightFromRight: warmSide)
}

func paintDialMarkings(_ c: CGContext, _ d: Dial, night: Bool) {
    let p = d.pivot
    let major = d.id == "rpm" ? [0.0, 500.0] + d.labels.map(\.0) : d.labels.map(\.0)
    let warmSide = d.id == "rpm" || d.id == "oil"
    let tickAngles = (d.curve.first![1] - 1.6, d.curve.last![1] + (d.id == "rpm" ? 12 : 1.6))
    let rail = steppedRail(d, tickAngles, major)
    stroke(c, rail, color(17, 22, 28, night ? 0.60 : 0.36), d.small ? 3.5 : 4.3)
    let railInk = night ? (warmSide ? color(249, 246, 244) : color(239, 249, 252))
                        : (warmSide ? color(171, 179, 188) : color(163, 174, 186))
    stroke(c, rail, railInk, d.small ? 2.05 : 2.55)
    let low = d.curve.first![0], high = d.curve.last![0]
    let count = Int((high - low) / d.step)
    // The F82 reference shows a short mark between READY and 1.
    let tickValues = (0...count).map { low + Double($0) * d.step } + (d.id == "rpm" ? [750.0] : [])
    let tickInk = night ? (warmSide ? color(239, 237, 235) : color(230, 241, 245))
                        : (warmSide ? color(157, 166, 176) : color(153, 165, 177))
    for (i, value) in tickValues.enumerated() {
        if major.contains(where: { abs($0 - value) < 0.001 }) { continue }
        let theta = angle(d, value)
        let tickLength = d.small ? 6.7 : (d.id == "speed" && i % 3 == 1 ? 7.0 : 9.2)
        stroke(c, [railPoint(d, d.railRadius, theta), railPoint(d, d.railRadius - tickLength, theta)],
               tickInk, d.small ? 1.85 : 2.15)
    }
    let textInk = night ? (warmSide ? color(252, 249, 247) : color(242, 251, 253)) : color(201, 209, 218)
    for (value, text) in d.labels {
        let labelRadius: Double
        switch d.id {
        case "speed":
            // The wider numbers along the right edge need more room at the notch.
            labelRadius = value <= 210 ? 166 : (value == 240 ? 161 : 160)
        case "rpm":
            labelRadius = 168
        case "oil":
            labelRadius = value == d.labels[1].0 ? 58 : 54
        default:
            labelRadius = 61
        }
        let q = railPoint(d, labelRadius, angle(d, value))
        let size: Double = d.small ? 24 : (d.id == "speed" ? 32 : 35)
        label(c, text, q.x, q.y, size, ink: textInk)
    }
    if !d.unit.isEmpty {
        label(c, d.unit, p.x, p.y - (d.small ? 46 : 67), d.small ? 16 : 18,
              ink: textInk, font: "HelveticaNeue-Medium")
    }
    if d.id == "rpm" {
        for (value, text) in [(0.0, "OFF"), (500.0, "READY")] {
            let q = point(p, 161, angle(d, value))
            label(c, text, q.x + 4, q.y, 16, ink: textInk, font: "HelveticaNeue-Medium")
        }
    }
    if d.id == "fuel" { fuelIcon(c, p.x - 55, p.y - 3, night: night) }
    if d.id == "oil" { oilTemperatureIcon(c, p.x + 47, p.y + 10, night: night) }
}

func paintAuxNeedleShadow(_ c: CGContext, _ pivot: CGPoint, _ radius: Double, _ hub: Double, widthScale: Double) {
    // A small needle casts a recognizable tapered silhouette. A broad Gaussian
    // loses its contrast beneath the acrylic blade at ordinary preview sizes.
    let top = pivot.y - radius + 2
    let bottom = pivot.y - hub * 0.56
    let root = hub * 0.124 * widthScale * 0.94
    let shape = [CGPoint(x: pivot.x - 0.65, y: top), CGPoint(x: pivot.x + 0.65, y: top),
                 CGPoint(x: pivot.x + root, y: bottom), CGPoint(x: pivot.x - root, y: bottom)]
    // Keep the penumbra close to the shaft; no diffuse halo around the cup.
    c.saveGState()
    c.setShadow(offset: .zero, blur: 1.35, color: color(1, 3, 5, 0.28))
    polygon(c, shape, color(2, 4, 6, 0.14))
    c.restoreGState()
    c.saveGState()
    c.addLines(between: shape)
    c.closePath()
    c.clip()
    let tones = [color(2, 4, 6, 0), color(2, 4, 6, 0.80), color(2, 4, 6, 0.86),
                 color(2, 4, 6, 0.86), color(2, 4, 6, 0)]
    let shade = CGGradient(colorsSpace: space, colors: tones as CFArray, locations: [0, 0.045, 0.18, 0.94, 1])!
    c.drawLinearGradient(shade, start: CGPoint(x: pivot.x, y: top), end: CGPoint(x: pivot.x, y: bottom), options: [])
    c.restoreGState()
}

func paintDayNeedleShadow(_ c: CGContext, _ pivot: CGPoint, _ radius: Double, _ hub: Double, widthScale: Double, small: Bool) {
    // Cast a shaft-shaped silhouette onto the face. A narrow penumbra softens
    // the edge without turning the whole shadow into a diffuse Gaussian band.
    let top = pivot.y - radius + 2
    let bottom = pivot.y - hub * 0.56
    let root = hub * 0.124 * widthScale * (small ? 1.03 : 1.28)
    let tip = small ? 0.9 : 1.4
    let shaft = [CGPoint(x: pivot.x - tip, y: top), CGPoint(x: pivot.x + tip, y: top),
                 CGPoint(x: pivot.x + root, y: bottom), CGPoint(x: pivot.x - root, y: bottom)]
    c.saveGState()
    c.setShadow(offset: .zero, blur: small ? 1.1 : 1.2, color: color(1, 2, 3, 0.22))
    polygon(c, shaft, color(1, 2, 3, 0.12))
    c.restoreGState()
    c.saveGState()
    c.addLines(between: shaft)
    c.closePath()
    c.clip()
    let core: CGFloat = small ? 0.80 : 0.86
    let shade = CGGradient(colorsSpace: space,
                           colors: [color(1, 2, 3, 0), color(1, 2, 3, core), color(1, 2, 3, core), color(1, 2, 3, 0)] as CFArray,
                           locations: [0, 0.035, 0.95, 1])!
    c.drawLinearGradient(shade, start: CGPoint(x: pivot.x, y: top), end: CGPoint(x: pivot.x, y: bottom), options: [])
    c.restoreGState()
}

func paintNeedleFalloff(_ c: CGContext, _ pivot: CGPoint, _ radius: Double, _ hub: Double, shadow: Bool, widthScale: Double = 1, small: Bool = false) {
    if shadow && small {
        paintAuxNeedleShadow(c, pivot, radius, hub, widthScale: widthScale)
        return
    }
    let reach = hub * (shadow ? 0.235 * widthScale : 0.33)
    let top = pivot.y - radius + (shadow ? 2 : 0)
    // The displaced shadow must meet the hub even when the projection lands
    // farther inward. Fade its root inside the rim so it blends into the seat.
    let bottom = pivot.y + hub * (shadow ? -0.56 : 0.55)
    let taperStart = shadow ? 1 - hub * 0.60 / (bottom - top) : 0.83
    let across = shadow
        ? [color(3, 6, 8, 0), color(3, 6, 8, 0.055), color(3, 6, 8, 0.30), color(3, 6, 8, 0.63),
           color(3, 6, 8, 0.30), color(3, 6, 8, 0.055), color(3, 6, 8, 0)]
        : [color(209, 32, 12, 0), color(233, 42, 17, 0.045), color(248, 57, 20, 0.19), color(255, 72, 25, 0.51),
           color(248, 57, 20, 0.19), color(233, 42, 17, 0.045), color(209, 32, 12, 0)]
    let along = [color(255, 255, 255, 0), color(255, 255, 255, 0.67),
                 color(255, 255, 255, 0.85), color(255, 255, 255, 1), color(255, 255, 255, 0)]
    let spill = CGGradient(colorsSpace: space, colors: across as CFArray, locations: [0, 0.19, 0.36, 0.5, 0.64, 0.81, 1])!
    let taper = CGGradient(colorsSpace: space, colors: along as CFArray, locations: [0, 0.10, 0.48, taperStart, 1])!
    c.saveGState()
    c.clip(to: CGRect(x: pivot.x - reach, y: top, width: reach * 2, height: bottom - top))
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    c.drawLinearGradient(spill, start: CGPoint(x: pivot.x - reach, y: top), end: CGPoint(x: pivot.x + reach, y: top), options: [])
    c.saveGState()
    c.setBlendMode(.destinationIn)
    c.drawLinearGradient(taper, start: CGPoint(x: pivot.x, y: top), end: CGPoint(x: pivot.x, y: bottom), options: [])
    c.restoreGState()
    c.endTransparencyLayer()
    c.restoreGState()
}

func paintNeedle(_ c: CGContext, _ pivot: CGPoint, _ radius: Double, _ hub: Double, widthScale: Double, night: Bool, small: Bool = false, outward: Double = 0) {
    if night { paintNeedleFalloff(c, pivot, radius, hub, shadow: false) }
    let bodyWidth = hub * 0.094 * widthScale
    let shoulder = bodyWidth * 1.7
    let bladeWidth = hub * 0.124 * widthScale
    let tipWidth = bladeWidth * needleTipRatio
    let tipY = pivot.y - radius
    let tailY = pivot.y + hub * needleTailScale
    let chamfer = hub * 0.045
    let body = [CGPoint(x: pivot.x - tipWidth, y: tipY),
                CGPoint(x: pivot.x + tipWidth, y: tipY),
                CGPoint(x: pivot.x + shoulder, y: pivot.y - 4),
                CGPoint(x: pivot.x + shoulder, y: tailY - chamfer),
                CGPoint(x: pivot.x + shoulder - chamfer, y: tailY),
                CGPoint(x: pivot.x - shoulder + chamfer, y: tailY),
                CGPoint(x: pivot.x - shoulder, y: tailY - chamfer),
                CGPoint(x: pivot.x - shoulder, y: pivot.y - 4)]
    if night {
        polygon(c, body.map { CGPoint(x: $0.x + 1.5, y: $0.y + 1) }, color(7, 9, 12, 0.58))
    }
    c.saveGState()
    c.addLines(between: body)
    c.closePath()
    c.clip()
    shade(c, night ? [color(29, 30, 33), color(12, 13, 16), color(5, 6, 8)]
                   : [color(58, 62, 66), color(28, 30, 34), color(14, 16, 19)],
          CGPoint(x: pivot.x - bodyWidth * 2, y: 0), CGPoint(x: pivot.x + bodyWidth * 2, y: 0))
    c.restoreGState()
    if small {
        // The acrylic blade has a narrow luminous rear edge even when it faces
        // inward. This is separate from the broad angle-faded glass sidewall.
        // Both edges stop before the cap, so no red strip crosses its surface.
        let top = tipY + 1.2
        let bottom = pivot.y - hub - 0.5
        let progress = (bottom - top) / (pivot.y - 4 - top)
        let edgeAtHub = tipWidth + (shoulder - tipWidth) * progress
        func edge(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: pivot.x - outward * x, y: y)
        }
        polygon(c, [edge(tipWidth + 0.12, top), edge(tipWidth + 1.62, top + 0.6),
                    edge(edgeAtHub + 1.67, bottom), edge(edgeAtHub + 0.06, bottom)],
                night ? color(255, 43, 33, 0.66) : color(177, 42, 35, 0.40))
    }
    // Keep the original shaft taper and carry the red across the cap to its far rim.
    let bladeShoulderY = pivot.y + hub * 0.39
    let bladeEndY = pivot.y + hub * 0.95
    let red = [CGPoint(x: pivot.x - tipWidth, y: tipY), CGPoint(x: pivot.x + tipWidth, y: tipY),
               CGPoint(x: pivot.x + bladeWidth, y: bladeShoulderY), CGPoint(x: pivot.x + bladeWidth, y: bladeEndY),
               CGPoint(x: pivot.x - bladeWidth, y: bladeEndY), CGPoint(x: pivot.x - bladeWidth, y: bladeShoulderY)]
    c.saveGState()
    c.addLines(between: red)
    c.closePath()
    c.clip()
    shade(c, night
          ? (small ? [color(208, 29, 22), color(255, 65, 40), color(255, 52, 31), color(244, 39, 24), color(204, 24, 18)]
                   : [color(211, 40, 14), color(255, 100, 41), color(255, 82, 23), color(247, 55, 15), color(208, 30, 10)])
          : [color(210, 77, 64), color(193, 40, 32), color(130, 22, 20)],
          CGPoint(x: pivot.x - bladeWidth, y: 0), CGPoint(x: pivot.x + bladeWidth, y: 0))
    c.restoreGState()
}

func paintNeedleGlass(_ c: CGContext, _ pivot: CGPoint, _ radius: Double, _ hub: Double,
                      widthScale: Double, outward: Double, night: Bool) {
    let tip = hub * 0.124 * widthScale * needleTipRatio
    let shoulder = hub * 0.094 * widthScale * 1.7
    let top = pivot.y - radius + 1.2
    // End at the leading edge of the cap. This clearance also holds when the
    // glass sprite narrows horizontally during the sweep.
    let bottom = pivot.y - hub - 0.5
    let shaftProgress = (bottom - top) / (pivot.y - 3 - top)
    func atCap(_ tipX: Double, _ shoulderX: Double) -> Double {
        tipX + (shoulderX - tipX) * shaftProgress
    }
    func pointOnWall(_ x: Double, _ y: Double) -> CGPoint {
        CGPoint(x: pivot.x - outward * x, y: y)
    }
    let backTip = pointOnWall(tip + 1.23, top + 0.4)
    let backRoot = pointOnWall(atCap(tip + 1.23, shoulder + 3.93), bottom)
    c.saveGState()
    c.clip(to: CGRect(x: pivot.x - shoulder - 4, y: top, width: (shoulder + 4) * 2, height: bottom - top))
    c.beginTransparencyLayer(auxiliaryInfo: nil)
    polygon(c, [pointOnWall(tip - 0.65, top), backTip, backRoot,
                pointOnWall(atCap(tip - 0.65, shoulder - 2), bottom)],
            night ? color(173, 124, 118, 0.48) : color(161, 121, 117, 0.46))
    polygon(c, [backTip, backRoot, pointOnWall(atCap(tip + 0.67, shoulder + 2.64), bottom),
                pointOnWall(tip + 0.67, top + 0.4)],
            night ? color(234, 77, 52, 0.73) : color(202, 65, 47, 0.76))
    c.saveGState()
    c.setBlendMode(.destinationIn)
    let stops: [CGFloat] = [0, 0.11, 1 - 3 / (bottom - top), 1]
    let mask = [0.0, 0.94, 1, 0].map { color(255, 255, 255, $0) }
    let fade = CGGradient(colorsSpace: space, colors: mask as CFArray, locations: stops)!
    c.drawLinearGradient(fade, start: CGPoint(x: pivot.x, y: top), end: CGPoint(x: pivot.x, y: bottom), options: [])
    c.restoreGState()
    c.endTransparencyLayer()
    c.restoreGState()
}

func paintTachWarningTrack(_ c: CGContext, _ dial: Dial, scale: Double, night: Bool) {
    // The gallery pose represents the warm stock G82. The live effect uses f82_sprite.js.
    let radius = tachWarningRadius * scale
    let amber = angle(dial, 6700), red = angle(dial, 7200)
    let pitch = angle(dial, 8000) - angle(dial, 7500)
    let amberInk = night ? color(255, 203, 16) : color(240, 184, 20)
    let redInk = night ? color(255, 61, 96) : color(255, 56, 91)
    let zones = [(amber, red, 1, amberInk),
                 (red, tachWarningEnd, Int(ceil((tachWarningEnd - red) / (pitch * 1.3))), redInk)]
    c.saveGState()
    c.setLineCap(.butt)
    for (from, to, count, ink) in zones {
        let cell = (to - from) / Double(count)
        let halfGap = 4 / radius * 180 / .pi
        for i in 0..<count {
            let first = from + Double(i) * cell + halfGap
            let last = first + cell - 2 * halfGap
            // Gallery approximation of the live shader's normal 60% bloom.
            c.saveGState()
            c.setShadow(offset: .zero, blur: 6, color: ink.copy(alpha: night ? 0.24 : 0.168))
            stroke(c, arc(dial.center, radius, first, last), ink.copy(alpha: 0.84)!, 8.6)
            c.restoreGState()
            stroke(c, arc(dial.center, radius, first + 0.28, last - 0.28), ink, 5.8)
        }
    }
    c.restoreGState()
}

func paintSurround(_ c: CGContext, _ width: Double, _ height: Double, night: Bool) {
    c.saveGState()
    c.scaleBy(x: width / 24, y: height / 9)
    c.clip(to: CGRect(x: 0, y: 0, width: 24, height: 9))
    shade(c, night ? [color(2, 3, 5), color(5, 5, 7), color(4, 4, 5)]
                   : [color(7, 8, 10), color(12, 13, 16), color(6, 8, 10)],
          CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 9))
    if night {
        radialShade(c, [color(55, 66, 88, 0.09), color(31, 36, 48, 0)], CGPoint(x: 3, y: 4.3), 8)
        radialShade(c, [color(83, 61, 42, 0.17), color(44, 32, 25, 0)], CGPoint(x: 18.5, y: 7.2), 8)
    } else {
        // Window light catches the outer shoulders. The brow shades the centre.
        let sideLight = [color(100, 113, 132, 0.030), color(71, 83, 102, 0.014), color(47, 57, 74, 0)]
        radialShade(c, sideLight, CGPoint(x: 1.8, y: 3.7), 6.5)
        radialShade(c, sideLight, CGPoint(x: 22.8, y: 4.3), 6.3)
        radialShade(c, [color(83, 76, 82, 0.12), color(64, 58, 68, 0)],
                    CGPoint(x: 7.9, y: 6.6), 6.5)
    }
    shade(c, [color(0, 0, 0, 0), color(0, 0, 0, 0.38)],
          CGPoint(x: 0, y: night ? 7.7 : 7.35), CGPoint(x: 0, y: 9))
    c.restoreGState()
}

func bitmap(_ w: Int, _ h: Int) -> CGContext {
    let flags = CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: space, bitmapInfo: flags)!
    ctx.translateBy(x: 0, y: Double(h))
    ctx.scaleBy(x: 1, y: -1)
    ctx.setShouldAntialias(true)
    return ctx
}

func straightRGBA(_ ctx: CGContext) -> Data {
    var data = Data(bytes: ctx.data!, count: ctx.width * ctx.height * 4)
    data.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) in
        for i in stride(from: 0, to: raw.count, by: 4) {
            let alpha = Int(raw[i + 3])
            if alpha > 0 && alpha < 255 {
                for channel in 0...2 { raw[i + channel] = UInt8(min(255, (Int(raw[i + channel]) * 255 + alpha / 2) / alpha)) }
            }
        }
    }
    return data
}

let root = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let assetDir = root.appendingPathComponent("apps/samagotia_clusters/cluster/f82")
try FileManager.default.createDirectory(at: assetDir, withIntermediateDirectories: true)
func writeJSON(_ data: Any, _ url: URL) throws {
    var encoded = try JSONSerialization.data(withJSONObject: data, options: [.prettyPrinted, .sortedKeys])
    encoded.append(10)
    try encoded.write(to: url, options: .atomic)
}

func sprite(_ id: String, _ ctx: CGContext, metadata: [String: Any] = [:]) throws {
    if previewsOnly { return }
    if needleShadowsOnly && !id.hasSuffix("-shadow-day") { return }
    if auxiliaryOnly && !id.hasPrefix("fuel-") && !id.hasPrefix("oil-") { return }
    var image = metadata
    image["w"] = ctx.width
    image["h"] = ctx.height
    image["rgba"] = straightRGBA(ctx).base64EncodedString()
    try writeJSON(image, assetDir.appendingPathComponent(id + ".json"))
}

func savedSpriteImage(_ id: String) throws -> CGImage {
    let object = try JSONSerialization.jsonObject(with: Data(contentsOf: assetDir.appendingPathComponent(id + ".json"))) as! [String: Any]
    let width = object["w"] as! Int, height = object["h"] as! Int
    let pixels = Data(base64Encoded: object["rgba"] as! String)!
    precondition(pixels.count == width * height * 4)
    let flags = CGBitmapInfo(rawValue: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.last.rawValue)
    return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                   space: space, bitmapInfo: flags, provider: CGDataProvider(data: pixels as CFData)!,
                   decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
}

func panelBackground(_ night: Bool) -> CGContext {
    // Day gradients are evaluated at four times the former resolution, avoiding
    // enlarged 10-pixel texture cells. Night retains its original light model.
    let factor = night ? 1 : 4
    let width = 192 * factor, height = 72 * factor
    let c = bitmap(width, height)
    // A broad curved falloff keeps the readouts seated in the same material.
    // Avoid multiplying every column by one horizontal cutoff at dial height.
    paintSurround(c, Double(width), Double(height), night: night)
    let pixels = c.data!.bindMemory(to: UInt8.self, capacity: width * height * 4)
    for y in 0..<height {
        for x in 0..<width {
            let logicalX = (Double(x) + 0.5) / Double(factor) - 0.5
            let logicalY = (Double(y) + 0.5) / Double(factor) - 0.5
            let centre = exp(-pow((logicalX - 96) / 34, 2))
            let cups = exp(-pow((logicalX - 65) / 26, 2)) + exp(-pow((logicalX - 135) / 26, 2))
            let begin = 47 + 8 * centre + 2 * cups
            let end = 65 + 9 * centre + 2 * cups
            let progress = max(0, min(1, (logicalY + 0.5 - begin) / (end - begin)))
            // Smootherstep has zero first and second derivatives at each end.
            let fade = night ? progress * progress * (3 - 2 * progress)
                : progress * progress * progress * (progress * (progress * 6 - 15) + 10)
            var opacity = 1 - fade
            // Preserve the lower-row colour falloff over an opaque black panel.
            // Never expose the stock gauge/readout artwork through this texture.
            let telltale = exp(-pow((logicalX - 51) / 14, 4))
            let row = max(0, min(1, (logicalY - 60) / 4))
            opacity *= 1 - telltale * row * row * (3 - 2 * row)
            for channel in 0..<3 {
                let i = (y * width + x) * 4 + channel
                pixels[i] = UInt8((Double(pixels[i]) * opacity).rounded())
            }
            pixels[(y * width + x) * 4 + 3] = 255
        }
    }
    if night {
        // Equal Day/Night texture sizes let the runtime replace pixels in place.
        // Bilinear resampling preserves the prior Night appearance.
        let expanded = bitmap(768, 288)
        expanded.interpolationQuality = .medium
        expanded.translateBy(x: 0, y: 288)
        expanded.scaleBy(x: 1, y: -1)
        expanded.draw(c.makeImage()!, in: CGRect(x: 0, y: 0, width: 768, height: 288))
        return expanded
    }
    return c
}

if CommandLine.arguments.contains("--background-only") {
    try sprite("background", panelBackground(false))
    try sprite("background-night", panelBackground(true))
    print("Updated full-panel backgrounds only; dial artwork and placements preserved")
    exit(0)
}

let gearFontName = "f82_gear"
let gearBaseline = 57
let fontDir = root.appendingPathComponent("apps/samagotia_clusters/cluster/fonts")
try FileManager.default.createDirectory(at: fontDir, withIntermediateDirectories: true)

func bakeDialFont(_ name: String, characters: [Character], cell: CGSize, baseline: Int, capHeight: Double) throws {
    let cellWidth = Int(cell.width), cellHeight = Int(cell.height)
    let atlas = bitmap(cellWidth * characters.count, cellHeight)
    var glyphs: [String: [String: Int]] = [:]
    for (index, glyph) in characters.enumerated() {
        let x = index * cellWidth
        paintGearGlyph(atlas, glyph, Double(x) + cell.width / 2, Double(baseline), capHeight, ink: color(255, 255, 255))
        glyphs[String(glyph)] = ["x": x, "y": 0, "w": cellWidth, "h": cellHeight, "ox": 0, "advance": cellWidth]
    }
    try writeDialFont(name, atlas: atlas, glyphs: glyphs, baseline: baseline, capHeight: capHeight)
}

func writeDialFont(_ name: String, atlas: CGContext, glyphs: [String: [String: Int]], baseline: Int, capHeight: Double) throws {
    let coverage = atlas.data!.bindMemory(to: UInt8.self, capacity: atlas.width * atlas.height * 4)
    let alpha = Data((0..<(atlas.width * atlas.height)).map { coverage[$0 * 4 + 3] })
    try writeJSON(["source": "F82 reference lettering and DIN Alternate Bold", "size": Int(capHeight),
                   "cellHeight": atlas.height, "baseline": baseline, "glyphs": glyphs,
                   "width": atlas.width, "height": atlas.height, "alpha": alpha.base64EncodedString()],
                  fontDir.appendingPathComponent(name + ".json"))
}

func bakeInfoFont() throws {
    let calendar: Character = "\u{E000}"
    let fuelPump: Character = "\u{E001}"
    let rule: Character = "\u{E002}"
    let rangeArrow: Character = "\u{E003}"
    // Append new glyphs so all existing atlas coordinates and metrics stay stable.
    let characters = Array("+- 0123456789°CF./:apmiglk") + [calendar, fuelPump, rule, rangeArrow] + Array("uersvØhDonHdBtTP")
    let capHeight = 23.0, baseline = 25, cellWidth = 30, cellHeight = 30
    let font = CTFontCreateWithName("DINAlternate-Bold" as CFString, capHeight / CTFontGetCapHeight(gearFont), nil)
    let atlas = bitmap(cellWidth * characters.count, cellHeight)
    var glyphs: [String: [String: Int]] = [:]
    for (index, character) in characters.enumerated() {
        let text = String(character), x = index * cellWidth
        if character == calendar {
            atlas.saveGState()
            atlas.translateBy(x: Double(x + 1), y: 0)
            atlas.setStrokeColor(color(255, 255, 255))
            atlas.setLineWidth(1.8)
            atlas.stroke(CGRect(x: 1.5, y: 7, width: 16, height: 17))
            atlas.beginPath()
            atlas.move(to: CGPoint(x: 1.5, y: 12))
            atlas.addLine(to: CGPoint(x: 17.5, y: 12))
            for tabX in [5.0, 14.0] {
                atlas.move(to: CGPoint(x: tabX, y: 4.5))
                atlas.addLine(to: CGPoint(x: tabX, y: 9))
            }
            atlas.strokePath()
            atlas.restoreGState()
            glyphs[text] = ["x": x, "y": 0, "w": cellWidth, "h": cellHeight, "ox": -1, "advance": 20]
            continue
        }
        if character == fuelPump {
            fuelIcon(atlas, Double(x + 10), 14, night: true, arrow: false)
            glyphs[text] = ["x": x, "y": 0, "w": cellWidth, "h": cellHeight, "ox": -1, "advance": 24]
            continue
        }
        if character == rule {
            atlas.setFillColor(color(255, 255, 255))
            atlas.fill(CGRect(x: x + 1, y: 21, width: 20, height: 2))
            glyphs[text] = ["x": x, "y": 0, "w": cellWidth, "h": cellHeight, "ox": -1, "advance": 20]
            continue
        }
        if character == rangeArrow {
            let outline: [(Int, Int)] = [(1, 12), (10, 12), (10, 7), (19, 14), (10, 21), (10, 16), (1, 16)]
            polygon(atlas, outline.map { CGPoint(x: x + 1 + $0.0, y: $0.1) }, color(255, 255, 255))
            glyphs[text] = ["x": x, "y": 0, "w": cellWidth, "h": cellHeight, "ox": -1, "advance": 22]
            continue
        }
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font,
            NSAttributedString.Key(kCTForegroundColorAttributeName as String): color(255, 255, 255),
        ]))
        let advance = Int(CTLineGetTypographicBounds(line, nil, nil, nil).rounded())
        atlas.saveGState()
        atlas.translateBy(x: Double(x + 1), y: Double(baseline))
        atlas.scaleBy(x: 1, y: -1)
        atlas.textPosition = .zero
        CTLineDraw(line, atlas)
        atlas.restoreGState()
        glyphs[text] = ["x": x, "y": 0, "w": cellWidth, "h": cellHeight, "ox": -1, "advance": advance]
    }
    try writeDialFont("f82_info", atlas: atlas, glyphs: glyphs, baseline: baseline, capHeight: capHeight)
}

if CommandLine.arguments.contains("--info-font-only") {
    try bakeInfoFont()
    print("Extended the information font only; all dial artwork preserved")
    exit(0)
}

// Derive optional amber faces from the saved Original images. Only the
// premultiplied contribution of the printing changes; all material pixels,
// shadows, rims, hubs, badge and alpha remain identical to the saved artwork.
func bakeAmberFaces(_ only: [(Dial, String)]? = nil) throws {
    let variants: [(Dial, String)] = only ?? ([(speed, "speed-face"), (speedMph, "speed-face-mph"),
        (rpm, "rpm-face"), (dieselRpm, "rpm-face-diesel"), (fuel, "fuel-face"),
        (oil, "oil-face"), (oilFahrenheit, "oil-face-fahrenheit")] + oilScaleVariants)
    for (d, asset) in variants {
        let scale = d.small ? auxiliaryDialScale : mainDialScale
        let padding = d.small ? (12.0, 7.0) : (20.0, 8.0)
        for night in [false, true] {
            let id = asset + (night ? "-night" : "")
            var image = try JSONSerialization.jsonObject(with: Data(contentsOf: assetDir.appendingPathComponent(id + ".json"))) as! [String: Any]
            let w = image["w"] as! Int, h = image["h"] as! Int
            var result = [UInt8](Data(base64Encoded: image["rgba"] as! String)!)
            let c = bitmap(w, h)
            c.translateBy(x: padding.0, y: padding.1)
            c.scaleBy(x: scale, y: scale)
            paintDialMarkings(c, d, night: night)
            let mask = [UInt8](straightRGBA(c))
            // One coverage mask avoids colour-dependent font rasterization.
            // Preserve coverage; strengthen the printing's red and reduce blue
            // for a richer orange amber without adding bloom to the material.
            let factors = [1.08, 0.70, 0.40]
            for i in stride(from: 0, to: result.count, by: 4) {
                let alpha = Int(result[i + 3]), maskAlpha = Int(mask[i + 3])
                guard alpha > 0 && maskAlpha > 0 && mask[i] > 60 else { continue }
                for channel in 0...2 {
                    let delta = Double(mask[i + channel]) * (factors[channel] - 1) * Double(maskAlpha) / Double(alpha)
                    result[i + channel] = UInt8(max(0, min(255, Int((Double(result[i + channel]) + delta).rounded()))))
                }
            }
            image["rgba"] = Data(result).base64EncodedString()
            try writeJSON(image, assetDir.appendingPathComponent(id + "-amber.json"))
        }
    }
}

// Use the rendered label difference to retain the saved metal, shadows and hub
// pixel-for-pixel. Both unit variants keep their calibration in Celsius.
func bakeOilScaleFaces() throws {
    for (index, variant) in oilScaleVariants.enumerated() {
        let (dial, asset) = variant
        let originalDial = index == 0 ? oil : oilFahrenheit
        let originalAsset = index == 0 ? "oil-face" : "oil-face-fahrenheit"
        for night in [false, true] {
            let suffix = night ? "-night" : ""
            var image = try JSONSerialization.jsonObject(with: Data(contentsOf: assetDir.appendingPathComponent(originalAsset + suffix + ".json"))) as! [String: Any]
            let w = image["w"] as! Int, h = image["h"] as! Int
            var renders: [[UInt8]] = []
            for d in [originalDial, dial] {
                let c = bitmap(w, h)
                c.translateBy(x: 12, y: 7)
                c.scaleBy(x: auxiliaryDialScale, y: auxiliaryDialScale)
                paintFace(c, d, night: night)
                renders.append([UInt8](straightRGBA(c)))
            }
            var result = [UInt8](Data(base64Encoded: image["rgba"] as! String)!)
            for i in stride(from: 0, to: result.count, by: 4) {
                precondition(renders[0][i + 3] == renders[1][i + 3], "Scale labels must preserve coverage")
                for channel in 0...2 {
                    let delta = Int(renders[1][i + channel]) - Int(renders[0][i + channel])
                    result[i + channel] = UInt8(max(0, min(255, Int(result[i + channel]) + delta)))
                }
            }
            image["rgba"] = Data(result).base64EncodedString()
            image["oilCurve"] = oil50.curve
            image["temperatureLabels"] = dial.labels.map { $0.0 }
            image["temperatureUnit"] = dial.unit
            try writeJSON(image, assetDir.appendingPathComponent(asset + suffix + ".json"))
        }
    }
}

if CommandLine.arguments.contains("--oil-scale-faces-only") {
    try bakeOilScaleFaces()
    try bakeAmberFaces(oilScaleVariants)
    print("Baked 50–150 °C oil scale and equivalent Fahrenheit faces; existing artwork and layout preserved")
    exit(0)
}

// Apply only a metal-surface colour delta to saved Original Day faces. The
// coverage mask, positions, shadows, printing, panel and Night images stay put.
if CommandLine.arguments.contains("--day-rims-only") {
    let variants: [(Dial, String)] = [(speed, "speed-face"), (speedMph, "speed-face-mph"),
        (rpm, "rpm-face"), (dieselRpm, "rpm-face-diesel"), (fuel, "fuel-face"),
        (oil, "oil-face"), (oilFahrenheit, "oil-face-fahrenheit")]
    for (d, asset) in variants {
        let url = assetDir.appendingPathComponent(asset + ".json")
        var image = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        if image["dayRimFinish"] as? String == "polished-v1" { continue }
        let w = image["w"] as! Int, h = image["h"] as! Int
        let scale = d.small ? auxiliaryDialScale : mainDialScale
        let padding = d.small ? (12.0, 7.0) : (20.0, 8.0)
        var masks: [[UInt8]] = []
        for polished in [false, true] {
            let c = bitmap(w, h)
            c.translateBy(x: padding.0, y: padding.1)
            c.scaleBy(x: scale, y: scale)
            paintMetalRim(c, d, Double(d.size) / 2 - 5, night: false, polishedDay: polished)
            masks.append([UInt8](straightRGBA(c)))
        }
        var result = [UInt8](Data(base64Encoded: image["rgba"] as! String)!)
        for i in stride(from: 0, to: result.count, by: 4) {
            let alpha = Int(result[i + 3]), maskAlpha = Int(masks[0][i + 3])
            guard alpha > 0 && maskAlpha > 0 else { continue }
            precondition(abs(Int(masks[0][i + 3]) - Int(masks[1][i + 3])) <= 1,
                         "Metal finish must preserve geometry")
            for channel in 0...2 {
                let delta = Double((Int(masks[1][i + channel]) - Int(masks[0][i + channel])) * maskAlpha) / Double(alpha)
                result[i + channel] = UInt8(max(0, min(255, Int((Double(result[i + channel]) + delta).rounded()))))
            }
        }
        image["rgba"] = Data(result).base64EncodedString()
        image["dayRimFinish"] = "polished-v1"
        try writeJSON(image, url)
    }
    try bakeAmberFaces()
    print("Updated only Day metal surfaces and matching Amber faces; shape and Night assets preserved")
    exit(0)
}

// Migrate the existing Day artwork with the rendered difference only. The wall
// and its inward shadow live within existing images, with no added screen RAM.
if CommandLine.arguments.contains("--day-rim-depth-only") {
    let variants: [(Dial, String)] = [(speed, "speed-face"), (speedMph, "speed-face-mph"),
        (rpm, "rpm-face"), (dieselRpm, "rpm-face-diesel"), (fuel, "fuel-face"),
        (oil, "oil-face"), (oilFahrenheit, "oil-face-fahrenheit")]
    for (d, asset) in variants {
        let originalURL = assetDir.appendingPathComponent(asset + ".json")
        let original = try JSONSerialization.jsonObject(with: Data(contentsOf: originalURL)) as! [String: Any]
        let previousDepth = original["dayRimDepth"] as? String
        if previousDepth == "dimensional-v3" { continue }
        precondition(previousDepth == nil || previousDepth == "dimensional-v1" || previousDepth == "dimensional-v2", "Unknown Day rim-depth revision")
        let w = original["w"] as! Int, h = original["h"] as! Int
        let scale = Double(Int((Double(d.size) * (d.small ? auxiliaryDialScale : mainDialScale)).rounded())) / Double(d.size)
        let padding = d.small ? (12.0, 7.0) : (20.0, 8.0)
        var rendered: [[UInt8]] = []
        for dimensional in [false, true] {
            let c = bitmap(w, h)
            c.translateBy(x: padding.0, y: padding.1)
            c.scaleBy(x: scale, y: scale)
            paintFace(c, d, night: false, dimensionalDayRim: dimensional || previousDepth != nil,
                      innerRimShadowScale: dimensional ? 1.30 : previousDepth == "dimensional-v2" ? 1.15 : 1.0)
            rendered.append([UInt8](straightRGBA(c)))
        }
        for suffix in ["", "-amber"] {
            let url = assetDir.appendingPathComponent(asset + suffix + ".json")
            var image = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
            var pixels = [UInt8](Data(base64Encoded: image["rgba"] as! String)!)
            precondition(pixels.count == rendered[0].count)
            for i in stride(from: 0, to: pixels.count, by: 4) {
                // Preserve the saved silhouette, including its exact alpha edge.
                if pixels[i + 3] == 0 || rendered[0][i + 3] != rendered[1][i + 3] { continue }
                for channel in 0...2 {
                    let delta = Int(rendered[1][i + channel]) - Int(rendered[0][i + channel])
                    pixels[i + channel] = UInt8(max(0, min(255, Int(pixels[i + channel]) + delta)))
                }
            }
            image["rgba"] = Data(pixels).base64EncodedString()
            image["dayRimDepth"] = "dimensional-v3"
            try writeJSON(image, url)
        }
    }
    print("Updated 14 Day faces with polished front metal, inner walls and inward shadows; Night and placements preserved")
    exit(0)
}

// Recolour only the existing Day badge coverage, retaining every other face
// pixel and its original antialiasing. Night already has the illuminated badge.
if CommandLine.arguments.contains("--day-badge-only") {
    let scale = Double(Int((Double(speed.size) * mainDialScale).rounded())) / Double(speed.size)
    for asset in ["speed-face", "speed-face-mph"] {
        let originalURL = assetDir.appendingPathComponent(asset + ".json")
        let original = try JSONSerialization.jsonObject(with: Data(contentsOf: originalURL)) as! [String: Any]
        if original["dayBadgeFinish"] as? String == "clear-v1" { continue }
        let w = original["w"] as! Int, h = original["h"] as! Int
        var masks: [[UInt8]] = []
        for vivid in [false, true] {
            let c = bitmap(w, h)
            c.translateBy(x: 20, y: 8)
            c.scaleBy(x: scale, y: scale)
            badge(c, speed.pivot.x, speed.pivot.y + 145, night: false, vividDay: vivid)
            masks.append([UInt8](straightRGBA(c)))
        }
        for suffix in ["", "-amber"] {
            let url = assetDir.appendingPathComponent(asset + suffix + ".json")
            var image = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
            var pixels = [UInt8](Data(base64Encoded: image["rgba"] as! String)!)
            for i in stride(from: 0, to: pixels.count, by: 4) {
                let coverage = Int(masks[0][i + 3]), alpha = Int(pixels[i + 3])
                guard coverage > 0 && alpha > 0 else { continue }
                precondition(coverage == Int(masks[1][i + 3]), "Badge recolouring cannot change geometry")
                for channel in 0...2 {
                    let delta = Double((Int(masks[1][i + channel]) - Int(masks[0][i + channel])) * coverage) / Double(alpha)
                    pixels[i + channel] = UInt8(max(0, min(255, Int((Double(pixels[i + channel]) + delta).rounded()))))
                }
            }
            image["rgba"] = Data(pixels).base64EncodedString()
            image["dayBadgeFinish"] = "clear-v1"
            try writeJSON(image, url)
        }
    }
    print("Updated only the Day M badge in metric/mph Original and Amber faces; Night and all other artwork preserved")
    exit(0)
}

// Transfer just the joint/plane-lighting difference onto saved faces. Rendering
// both revisions preserves the exact masks of all printing, hubs and rims.
// The marker makes this pass repeatable without accumulating darker coats.
if CommandLine.arguments.contains("--day-surfaces-only") {
    let variants: [(Dial, String)] = [(speed, "speed-face"), (speedMph, "speed-face-mph"),
        (rpm, "rpm-face"), (dieselRpm, "rpm-face-diesel")]
    for (d, asset) in variants {
        let url = assetDir.appendingPathComponent(asset + ".json")
        let saved = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: Any]
        let previousLighting = saved["daySurfaceLighting"] as? String
        if previousLighting == "balanced-v2" { continue }
        precondition(previousLighting == nil || previousLighting == "shallow-v1", "Unknown Day lighting revision")
        let w = saved["w"] as! Int, h = saved["h"] as! Int
        var rendered: [[UInt8]] = []
        for balanced in [false, true] {
            let c = bitmap(w, h)
            c.translateBy(x: 20, y: 8)
            c.scaleBy(x: mainDialScale, y: mainDialScale)
            paintFace(c, d, night: false, surfaceLighting: balanced || previousLighting == "shallow-v1",
                      balancedDay: balanced)
            rendered.append([UInt8](straightRGBA(c)))
        }
        for suffix in ["", "-amber"] {
            let target = assetDir.appendingPathComponent(asset + suffix + ".json")
            var image = try JSONSerialization.jsonObject(with: Data(contentsOf: target)) as! [String: Any]
            var pixels = [UInt8](Data(base64Encoded: image["rgba"] as! String)!)
            precondition(pixels.count == rendered[0].count)
            for i in stride(from: 0, to: pixels.count, by: 4) {
                // Do not transfer the clip's antialiasing changes at the dial
                // silhouette: only opaque surface pixels receive this pass.
                if rendered[0][i + 3] != 255 || rendered[1][i + 3] != 255 || pixels[i + 3] != 255 { continue }
                for channel in 0...2 {
                    let delta = Int(rendered[1][i + channel]) - Int(rendered[0][i + channel])
                    pixels[i + channel] = UInt8(max(0, min(255, Int(pixels[i + channel]) + delta)))
                }
            }
            image["rgba"] = Data(pixels).base64EncodedString()
            image["daySurfaceLighting"] = "balanced-v2"
            try writeJSON(image, target)
        }
    }
    print("Balanced Day joints and surface light on the four main-face variants and matching Amber surfaces; Night and other artwork preserved")
    exit(0)
}

if CommandLine.arguments.contains("--backlights-only") {
    try bakeAmberFaces()
    print("Baked 14 optional Amber faces; Original images and layout preserved")
    exit(0)
}

if auxiliaryOnly || needleShadowsOnly {
    // The auxiliary pass must never reset a user's dial placements. Static
    // previews use these geometry constants, so reject drift before any writes.
    let layoutURL = root.appendingPathComponent("apps/samagotia_clusters/cluster/layouts/our_m4.json")
    let layout = try JSONSerialization.jsonObject(with: Data(contentsOf: layoutURL)) as! [String: Any]
    let saved = layout["widgets"] as! [[String: Any]]
    for d in dials {
        let diameter = Int((Double(d.size) * (d.small ? auxiliaryDialScale : mainDialScale)).rounded())
        let scale = Double(diameter) / Double(d.size)
        let pad = d.small ? (12, 7, 5, 12) : (20, 8, 5, 8)
        let needleWidth = 2 * Int(ceil(11 * scale))
        let pivotY = Int(ceil(Double(d.needleLength + 2) * scale))
        let expected = [
            d.id + "_face": ["x": Int((d.center.x - d.pivot.x * scale).rounded()) - pad.0,
                              "y": Int((d.center.y - d.pivot.y * scale).rounded()) - pad.1,
                              "w": diameter + pad.0 + pad.2,
                              "h": (d.small ? diameter : Int(ceil(410 * mainDialScale))) + pad.1 + pad.3],
            d.id + "_needle": ["x": Int(d.center.x) - needleWidth / 2,
                                "y": Int(d.center.y) - pivotY, "w": needleWidth,
                                "h": Int(ceil(Double(pivotY) + d.hubRadius * scale * needleTailScale)) + 3]
        ]
        for (id, dimensions) in expected {
            guard let widget = saved.first(where: { $0["id"] as? String == id }),
                  dimensions.allSatisfy({ (widget[$0.key] as? Int) == $0.value }) else {
                fatalError("Auxiliary-only bake: saved placement differs for " + id + "; preserve layout and update preview geometry first")
            }
        }
    }
}

if !auxiliaryOnly && !needleShadowsOnly {
try bakeDialFont(gearFontName, characters: gearCharacters, cell: gearCell, baseline: gearBaseline, capHeight: gearCapHeight)
try bakeDialFont("f82_speed", characters: Array("0123456789-"), cell: CGSize(width: 34, height: 47), baseline: 44, capHeight: 42)
try bakeInfoFont()
}

var widgets: [[String: Any]] = [["id": "backdrop", "type": "f82sprite", "asset": "background", "nightAsset": "background-night", "x": 0, "y": 0,
                                 "w": 1920, "h": 720, "z": 0, "own": true]]
let previews = [(night: false, suffix: "", thumb: bitmap(1920, 720)),
                (night: true, suffix: "-night", thumb: bitmap(1920, 720))]
for (night, suffix, thumb) in previews {
    let background: CGImage
    if auxiliaryOnly || needleShadowsOnly {
        // Preserve the latest independently baked panel shading in previews.
        background = try savedSpriteImage("background" + suffix)
    } else {
        let canvas = panelBackground(night)
        try sprite("background" + suffix, canvas)
        background = canvas.makeImage()!
    }
    thumb.setFillColor(color(0, 0, 0))
    thumb.fill(CGRect(x: 0, y: 0, width: 1920, height: 720))
    if needleShadowsOnly {
        thumb.saveGState()
        thumb.translateBy(x: 0, y: 720)
        thumb.scaleBy(x: 1, y: -1)
        thumb.draw(background, in: CGRect(x: 0, y: 0, width: 1920, height: 720))
        thumb.restoreGState()
    } else {
        thumb.draw(background, in: CGRect(x: 0, y: 0, width: 1920, height: 720))
    }
}
let sample = ["speed": 96.0, "rpm": 3100, "fuel": 0.58, "oil": 105]

for d in dials {
    let diameter = Int((Double(d.size) * (d.small ? auxiliaryDialScale : mainDialScale)).rounded())
    // The main dial textures end below the open bezel, so we never upload
    // the transparent rectangle beneath it.
    let faceHeight = d.small ? diameter : Int(ceil(410 * mainDialScale))
    let scale = Double(diameter) / Double(d.size)
    let faceOrigin = CGPoint(x: (d.center.x - d.pivot.x * scale).rounded(), y: (d.center.y - d.pivot.y * scale).rounded())
    // Transparent room for the falloff, outside the original face geometry.
    let padding = d.small ? (left: 12, top: 7, right: 5, bottom: 12) : (left: 20, top: 8, right: 5, bottom: 8)
    let textureWidth = diameter + padding.left + padding.right
    let textureHeight = faceHeight + padding.top + padding.bottom
    let faceAsset = d.id + "-face"
    let faceX = Int(faceOrigin.x) - padding.left, faceY = Int(faceOrigin.y) - padding.top
    var faceSpec: [String: Any] = ["id": d.id + "_face", "type": "f82sprite", "asset": faceAsset,
                                  "nightAsset": faceAsset + "-night", "x": faceX, "y": faceY,
                                  "w": textureWidth, "h": textureHeight, "z": 1, "own": true]
    if d.id == "rpm" {
        faceSpec["shiftTrack"] = [Double(textureWidth), Double(textureHeight), d.center.x - Double(faceX),
                                  d.center.y - Double(faceY), tachWarningRadius * scale, tachWarningEnd]
    }
    widgets.append(faceSpec)
    let hub = d.hubRadius * scale
    let length = Double(d.needleLength) * scale
    let widthScale = d.small ? 1.56 : 1.0
    let needleWidth = 2 * Int(ceil(11 * scale))
    let pivot = CGPoint(x: needleWidth / 2, y: Int(ceil(Double(d.needleLength + 2) * scale)))
    // Leave room below the tail for the antialiased edge and the Night drop shadow.
    let needleHeight = Int(ceil(pivot.y + hub * needleTailScale)) + 3
    // Keep the original sprite dimensions available to previously saved layouts.
    let needleAsset = d.id + "-needle-v2"
    let shadowAsset = needleAsset + "-shadow"
    let dayShadowAsset = needleAsset + "-shadow-day"
    let glassAsset = needleAsset + "-glass"
    let outward = d.id == "fuel" ? -1.0 : 1.0
    let shadowX = d.small ? -outward * 5.0 : 0
    let shadowY = d.small ? 2.0 : 8.0
    var shadowSpec: [String: Any] = ["asset": shadowAsset, "dayAsset": dayShadowAsset, "offsetY": shadowY / Double(needleHeight)]
    if d.small { shadowSpec["offsetX"] = shadowX / Double(needleWidth) }
    let shadow = bitmap(needleWidth, needleHeight)
    paintNeedleFalloff(shadow, pivot, length, hub, shadow: true, widthScale: widthScale, small: d.small)
    try sprite(shadowAsset, shadow)
    let dayShadow = bitmap(needleWidth, needleHeight)
    paintDayNeedleShadow(dayShadow, pivot, length, hub, widthScale: widthScale, small: d.small)
    try sprite(dayShadowAsset, dayShadow)
    var needleSpec: [String: Any] = ["id": d.id + "_needle", "type": "f82sprite", "asset": needleAsset,
                                     "nightAsset": needleAsset + "-night", "signal": d.signal, "curve": d.curve, "shadow": shadowSpec,
                                     "x": Int(d.center.x - pivot.x), "y": Int(d.center.y - pivot.y), "w": needleWidth, "h": needleHeight,
                                     "pivot": [Int(pivot.x), Int(pivot.y)], "z": 2, "own": true]
    if d.small { needleSpec["glass"] = ["asset": glassAsset, "nightAsset": glassAsset + "-night", "outward": outward] as [String: Any] }
    widgets.append(needleSpec)
    for (night, suffix, thumb) in previews {
        func bakeFace(_ dial: Dial, _ asset: String, metadata: [String: Any] = [:]) throws {
            let face = bitmap(textureWidth, textureHeight)
            face.translateBy(x: Double(padding.left), y: Double(padding.top))
            face.scaleBy(x: scale, y: scale)
            paintFace(face, dial, night: night)
            var faceMetadata = metadata
            if !night {
                faceMetadata["dayRimFinish"] = "polished-v1"
                faceMetadata["dayRimDepth"] = "dimensional-v3"
                if dial.id == "speed" { faceMetadata["dayBadgeFinish"] = "clear-v1" }
                if !dial.small { faceMetadata["daySurfaceLighting"] = "balanced-v2" }
            }
            try sprite(asset + suffix, face, metadata: faceMetadata)
        }
        try bakeFace(d, faceAsset)
        if d.id == "speed" {
            let kmhCurve = speedMph.curve.map { [$0[0] * 1.609344, $0[1]] }
            try bakeFace(speedMph, faceAsset + "-mph", metadata: ["speedCurve": kmhCurve])
        }
        if d.id == "rpm" {
            try bakeFace(dieselRpm, faceAsset + "-diesel", metadata: ["rpmCurve": dieselRpm.curve])
        }
        if d.id == "oil" {
            // Vehicle samples are in Celsius. Match them to the printed Fahrenheit stops.
            let celsiusCurve = oilFahrenheit.curve.map { [($0[0] - 32) * 5 / 9, $0[1]] }
            try bakeFace(oilFahrenheit, faceAsset + "-fahrenheit", metadata: ["oilCurve": celsiusCurve])
        }
        let needle = bitmap(needleWidth, needleHeight)
        paintNeedle(needle, pivot, length, hub, widthScale: widthScale, night: night, small: d.small, outward: outward)
        try sprite(needleAsset + suffix, needle)
        if d.small {
            let glass = bitmap(needleWidth, needleHeight)
            paintNeedleGlass(glass, pivot, length, hub, widthScale: widthScale, outward: outward, night: night)
            try sprite(glassAsset + suffix, glass)
        }
        if needleShadowsOnly {
            thumb.saveGState()
            thumb.translateBy(x: Double(faceX), y: Double(faceY + textureHeight))
            thumb.scaleBy(x: 1, y: -1)
            thumb.draw(try savedSpriteImage(faceAsset + suffix), in: CGRect(x: 0, y: 0, width: textureWidth, height: textureHeight))
            thumb.restoreGState()
        } else {
            thumb.saveGState()
            thumb.translateBy(x: faceOrigin.x, y: faceOrigin.y)
            thumb.scaleBy(x: scale, y: scale)
            paintFace(thumb, d, night: night)
            thumb.restoreGState()
        }
        if d.id == "rpm" { paintTachWarningTrack(thumb, d, scale: scale, night: night) }
        let degrees = angle(d, sample[d.id]!)
        let rotation = degrees * .pi / 180
        if !night || d.small {
            thumb.saveGState()
            let offsetScale = night ? 0.60 : (d.small ? 1.60 : 1.25)
            thumb.translateBy(x: d.center.x + shadowX * offsetScale, y: d.center.y + shadowY * offsetScale)
            thumb.rotate(by: rotation)
            let projection = abs(shadowX * cos(rotation) + shadowY * sin(rotation)) / hypot(shadowX, shadowY)
            thumb.setAlpha(night ? projection * 0.24 : 0.90)
            if night {
                paintNeedleFalloff(thumb, .zero, length, hub, shadow: true, widthScale: widthScale, small: d.small)
            } else {
                paintDayNeedleShadow(thumb, .zero, length, hub, widthScale: widthScale, small: d.small)
            }
            thumb.restoreGState()
        }
        thumb.saveGState()
        thumb.translateBy(x: d.center.x, y: d.center.y)
        thumb.rotate(by: rotation)
        if d.small {
            // Match the live reveal in f82_sprite.js.
            let t = min(1, max(0, (outward * degrees + 54) / 108))
            thumb.saveGState()
            thumb.setAlpha(min(1, (t + 0.3 * t * (1 - t)) * 1.25))
            thumb.scaleBy(x: (0.9 + 0.1 * t) * 1.10, y: 1)
            paintNeedleGlass(thumb, .zero, length, hub, widthScale: widthScale, outward: outward, night: night)
            thumb.restoreGState()
        }
        paintNeedle(thumb, .zero, length, hub, widthScale: widthScale, night: night, small: d.small, outward: outward)
        thumb.restoreGState()
    }
}

// The selector stays on the tachometer centreline. The engaged gear sits to its left while driving.
let gearX = Int(rpm.center.x)
let gearY = Int(rpm.center.y) + 148
let digitOffset = 47
let digitScale = 0.55
let gearColor = [229, 231, 219, 255]
let selectorHeight = Int(gearCell.height)
let selectorWidth = Int(gearCell.width) + 2 // The renderer pads each glyph by a pixel on both sides.
let digitWidth = Int((Double(selectorWidth) * digitScale).rounded())
let digitHeight = Int((Double(selectorHeight) * digitScale).rounded())
widgets.append(["id": "gear_selector", "type": "atext", "text": "{{stage}}", "font": gearFontName,
                "x": gearX - selectorWidth / 2, "y": gearY, "w": selectorWidth, "h": selectorHeight,
                "cells": 1, "z": 3, "color": gearColor])
widgets.append(["id": "gear_number", "type": "atext", "text": "{{gearInD}}", "font": gearFontName,
                "x": gearX - digitOffset - digitWidth / 2, "y": gearY + Int((Double(gearBaseline) * (1 - digitScale)).rounded()),
                "w": digitWidth, "h": digitHeight, "cells": 1, "z": 3, "color": gearColor])
for (night, _, thumb) in previews {
    let ink = color(229, 231, 219)
    paintGearGlyph(thumb, "D", Double(gearX), Double(gearY + gearBaseline), gearCapHeight, ink: ink)
    paintGearGlyph(thumb, "3", Double(gearX - digitOffset), Double(gearY + gearBaseline), gearCapHeight * digitScale, ink: ink)
    // Digital lower completion arc uses the tachometer centreline, as in the
    // live layout. It remains a flat grey display element, not more metal.
    stroke(thumb, arc(rpm.center, 258.5, 140, 220), night ? color(165, 173, 164) : color(126, 132, 128), 8)
}

if needleShadowsOnly && !previewsOnly {
    // Update only the Day shadow asset references. Preserve the saved layout,
    // including the user's placements and every other property.
    let layoutURL = root.appendingPathComponent("apps/samagotia_clusters/cluster/layouts/our_m4.json")
    var layout = try JSONSerialization.jsonObject(with: Data(contentsOf: layoutURL)) as! [String: Any]
    var saved = layout["widgets"] as! [[String: Any]]
    for i in saved.indices {
        if var shadow = saved[i]["shadow"] as? [String: Any], let asset = shadow["asset"] as? String {
            shadow["dayAsset"] = asset + "-day"
            saved[i]["shadow"] = shadow
        }
    }
    layout["widgets"] = saved
    try writeJSON(layout, layoutURL)
} else if !auxiliaryOnly && !previewsOnly {
try writeJSON(["schemaVersion": 2, "name": "F8X", "theme": "classic", "widgets": widgets,
               "_about": "Metric F82 dial-face study traced from the reference photo. Four static faces, four rotated needle sprites and a live gear readout. The full-panel backdrop is opaque; its colour fades smoothly to black."],
              root.appendingPathComponent("apps/samagotia_clusters/cluster/layouts/our_m4.json"))
}
for (_, suffix, thumb) in previews {
    if needleShadowsOnly && !previewsOnly && suffix == "-night" { continue }
    let png = NSBitmapImageRep(cgImage: thumb.makeImage()!).representation(using: .png, properties: [:])!
    try png.write(to: root.appendingPathComponent("docs/images/cluster-f82" + suffix + ".png"), options: .atomic)
}
if !needleShadowsOnly {
    try bakeOilScaleFaces()
    try bakeAmberFaces()
}
print(previewsOnly ? "Updated Day and Night static previews from saved faces; assets and layout preserved"
      : needleShadowsOnly ? "Updated Day needle shadow assets, references and Day static preview only; other artwork preserved"
      : auxiliaryOnly ? "Updated auxiliary faces/needles and static previews; main artwork, fonts and layout preserved"
                    : "Baked F82 day and night faces, needles and gallery images.")
