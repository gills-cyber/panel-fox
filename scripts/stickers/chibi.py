"""Chibi-style effect stickers for Panel Fox, drawn as SVG.

Style: soft dark outline, flat pastel fills, one white highlight, round
caps and joins, little faces on the friendly ones.
"""
import math, os

OUT = "#4a3346"  # outline: soft plum-black
SW = 14          # outline width at the 20-units-per-sticker-unit scale
os.makedirs("svg", exist_ok=True)


def svg(name, w, h, body, pad=0):
    W, H = w * 20, h * 20
    doc = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-pad} {-pad} {W + 2*pad} {H + 2*pad}" '
           f'width="{W + 2*pad}" height="{H + 2*pad}" stroke-linecap="round" stroke-linejoin="round">{body}</svg>')
    open(f"svg/{name}.svg", "w").write(doc)


def tube(d, fill, width, out=OUT, sw=SW):
    """A line drawn as an outlined tube: thick outline stroke under a thinner colour stroke."""
    return (f'<path d="{d}" fill="none" stroke="{out}" stroke-width="{width + 2*sw}"/>'
            f'<path d="{d}" fill="none" stroke="{fill}" stroke-width="{width}"/>')


def blobs(circles, fill, shade=None, out=OUT, sw=SW):
    """Merged puffy circles: all outlines first, then all fills, so the inside seams vanish."""
    s = "".join(f'<circle cx="{x}" cy="{y}" r="{r + sw/2}" fill="{out}"/>' for x, y, r in circles)
    s += "".join(f'<circle cx="{x}" cy="{y}" r="{r - sw/2}" fill="{fill}"/>' for x, y, r in circles)
    if shade:
        s += "".join(f'<circle cx="{x}" cy="{y + r*0.28}" r="{r*0.62}" fill="{shade}" opacity="0.55"/>' for x, y, r in circles)
        s += "".join(f'<circle cx="{x - r*0.1}" cy="{y - r*0.12}" r="{r*0.7}" fill="{fill}"/>' for x, y, r in circles)
    return s


def shape(d, fill, out=OUT, sw=SW, extra=""):
    return f'<path d="{d}" fill="{fill}" stroke="{out}" stroke-width="{sw}" {extra}/>'


def star4(cx, cy, R, k=0.2):
    q = R * k
    return (f"M{cx},{cy-R} Q{cx+q},{cy-q} {cx+R},{cy} Q{cx+q},{cy+q} {cx},{cy+R} "
            f"Q{cx-q},{cy+q} {cx-R},{cy} Q{cx-q},{cy-q} {cx},{cy-R} Z")


def drop(cx, cy, s, tilt=0):
    """Tear drop with its point up, bottom circle centred at (cx, cy) radius s."""
    d = (f"M0,{-2.1*s} C{0.25*s},{-1.5*s} {s},{-0.75*s} {s},0 "
         f"A{s},{s} 0 1 1 {-s},0 C{-s},{-0.75*s} {-0.25*s},{-1.5*s} 0,{-2.1*s} Z")
    return d, f'transform="translate({cx},{cy}) rotate({tilt})"'


def heart(cx, cy, s):
    p = [(0, .95), (-.22, .68), (-1, .12), (-1, -.35), (-1, -.75), (-.65, -1), (-.3, -1), (-.12, -1), (0, -.88), (0, -.7),
         (0, -.88), (.12, -1), (.3, -1), (.65, -1), (1, -.75), (1, -.35), (1, .12), (.22, .68), (0, .95)]
    f = lambda i: f"{cx + p[i][0]*s:.1f},{cy + p[i][1]*s:.1f}"
    d = f"M{f(0)}"
    for i in range(1, len(p), 3):
        d += f" C{f(i)} {f(i+1)} {f(i+2)}"
    return d + " Z"


def face(cx, cy, s, kind="happy", blush=True):
    """A tiny chibi face. kind: happy (^ ^), dots, sleepy, sad."""
    ex = 0.42 * s
    out = ""
    if kind == "happy":
        for sx in (-1, 1):
            out += (f'<path d="M{cx+sx*ex-0.16*s},{cy+0.05*s} Q{cx+sx*ex},{cy-0.16*s} {cx+sx*ex+0.16*s},{cy+0.05*s}" '
                    f'fill="none" stroke="{OUT}" stroke-width="{0.09*s}"/>')
    elif kind == "dots":
        for sx in (-1, 1):
            out += f'<ellipse cx="{cx+sx*ex}" cy="{cy}" rx="{0.09*s}" ry="{0.13*s}" fill="{OUT}"/>'
            out += f'<circle cx="{cx+sx*ex-0.03*s}" cy="{cy-0.05*s}" r="{0.035*s}" fill="#fff"/>'
    elif kind == "sleepy":
        for sx in (-1, 1):
            out += (f'<path d="M{cx+sx*ex-0.16*s},{cy-0.02*s} Q{cx+sx*ex},{cy+0.14*s} {cx+sx*ex+0.16*s},{cy-0.02*s}" '
                    f'fill="none" stroke="{OUT}" stroke-width="{0.08*s}"/>')
    elif kind == "sad":
        for sx in (-1, 1):
            out += f'<ellipse cx="{cx+sx*ex}" cy="{cy}" rx="{0.08*s}" ry="{0.12*s}" fill="{OUT}"/>'
    my = cy + 0.2 * s
    if kind == "sad":
        out += f'<path d="M{cx-0.1*s},{my+0.06*s} Q{cx},{my-0.04*s} {cx+0.1*s},{my+0.06*s}" fill="none" stroke="{OUT}" stroke-width="{0.07*s}"/>'
    else:
        out += (f'<path d="M{cx-0.14*s},{my} Q{cx-0.07*s},{my+0.1*s} {cx},{my} Q{cx+0.07*s},{my+0.1*s} {cx+0.14*s},{my}" '
                f'fill="none" stroke="{OUT}" stroke-width="{0.07*s}"/>')
    if blush:
        for sx in (-1, 1):
            out += f'<ellipse cx="{cx+sx*0.68*s}" cy="{cy+0.16*s}" rx="{0.15*s}" ry="{0.09*s}" fill="#ff8fb0" opacity="0.75"/>'
    return out


def shine(x, y, rx, ry, rot=-30):
    return f'<ellipse cx="{x}" cy="{y}" rx="{rx}" ry="{ry}" fill="#fff" opacity="0.9" transform="rotate({rot} {x} {y})"/>'


def twinkle(x, y, r, fill="#fff6b8"):
    return shape(star4(x, y, r, 0.22), fill, sw=SW * 0.6)


# --- steam: three soft rising curls ---------------------------------------
b = ""
for x, ph in ((90, 0), (165, 1), (240, 0)):
    d = f"M{x},590 " + " ".join(
        f"Q{x + (40 if (i + ph) % 2 else -40)},{590 - 80*i - 40} {x},{590 - 80*(i+1)}" for i in range(6))
    b += tube(d, "#ffffff", 30)
b += twinkle(270, 120, 26) + twinkle(60, 200, 18)
svg("steam", 16, 32, b, pad=10)

# --- wisps: food steam ribbons ------------------------------------------------
b = ""
for x, ph, top in ((110, 0, 120), (200, 1, 60), (290, 0, 140)):
    pts = []
    y = 560
    i = 0
    d = f"M{x},{y}"
    while y > top:
        ny = y - 90
        d += f" Q{x + (55 if (i + ph) % 2 else -55)},{y - 45} {x},{ny}"
        y = ny
        i += 1
    b += tube(d, "#fff4f0", 34)
svg("wisps", 20, 30, b, pad=10)

# --- fog: a bank of puffy clouds ---------------------------------------------
circ = [(110, 230, 90), (230, 180, 120), (380, 200, 110), (520, 170, 125), (670, 210, 105), (800, 235, 85),
        (300, 270, 80), (600, 270, 80), (450, 280, 75)]
b = blobs(circ, "#ffffff", shade="#d9d4f2")
svg("fog", 46, 18, b, pad=10)

# --- breath: three puffs, growing -------------------------------------------
b = ""
for (x, y, r) in ((70, 270, 38), (165, 215, 55), (305, 165, 90)):
    b += blobs([(x, y, r), (x + r*0.55, y + r*0.25, r*0.7), (x - r*0.5, y + r*0.3, r*0.6)], "#ffffff", shade="#cfe6ff")
svg("breath", 22, 18, b, pad=10)

# --- chill: gloomy blue lines with a snowflake ------------------------------
b = ""
for x in (70, 140, 210, 280):
    d = f"M{x},60 " + " ".join(f"Q{x + (22 if i % 2 else -22)},{60 + 55*i + 27} {x},{60 + 55*(i+1)}" for i in range(7))
    b += tube(d, "#9fc4ff", 20)
def flake(cx, cy, r):
    s = ""
    for a in range(0, 180, 60):
        dx, dy = r * math.cos(math.radians(a)), r * math.sin(math.radians(a))
        s += tube(f"M{cx-dx},{cy-dy} L{cx+dx},{cy+dy}", "#e8f4ff", 12, sw=8)
    return s
b += flake(300, 440, 40) + flake(60, 470, 28)
svg("chill", 18, 26, b, pad=10)

# --- smoke: tall puffy column ------------------------------------------------
circ = [(100, 570, 82), (66, 480, 58), (130, 470, 60), (95, 400, 62), (72, 320, 50), (125, 300, 48), (98, 235, 50), (120, 165, 40), (88, 120, 36), (108, 62, 28)]
b = blobs(circ, "#e7e3ee", shade="#b9b2c9")
svg("smoke", 10, 32, b, pad=10)

# --- aura: a big chibi flame -------------------------------------------------
fl = ("M180,580 C70,580 20,500 30,400 C40,320 90,290 80,210 C130,250 140,300 135,330 C150,250 170,150 230,60 "
      "C240,160 300,220 320,300 C335,360 330,420 315,460 C340,430 345,400 340,360 C380,430 360,580 180,580 Z")
fl2 = ("M180,560 C115,560 85,505 95,445 C105,395 140,370 140,320 C175,355 180,390 175,420 C200,370 215,320 240,270 "
       "C250,340 290,380 290,450 C290,520 250,560 180,560 Z")
b = shape(fl, "#ff9a3d") + f'<path d="{fl2}" fill="#ffd84d"/>'
svg("aura", 18, 30, b, pad=12)

# --- sparkle: a cluster of stars ---------------------------------------------
b = ""
for x, y, r in ((220, 210, 120), (95, 110, 55), (350, 95, 45), (360, 330, 60), (90, 340, 40), (230, 400, 28)):
    b += shape(star4(x, y, r, 0.22), "#ffe46b")
    b += f'<circle cx="{x - r*0.12}" cy="{y - r*0.12}" r="{r*0.1}" fill="#fff"/>'
for x, y in ((160, 40), (40, 230), (400, 220), (300, 420)):
    b += f'<circle cx="{x}" cy="{y}" r="11" fill="#ffe46b" stroke="{OUT}" stroke-width="7"/>'
svg("sparkle", 22, 22, b, pad=14)

# --- glint: one big shine star -----------------------------------------------
b = shape(star4(160, 160, 150, 0.2), "#fff3a6")
b += shape(star4(160, 160, 70, 0.25), "#ffffff", sw=0)
svg("glint", 16, 16, b, pad=14)

# --- heart: puffy heart with a happy face ------------------------------------
b = shape(heart(180, 170, 165), "#ff7aa8")
b += shine(110, 85, 32, 18)
svg("heart", 18, 16, b, pad=14)

# --- blush: two cheeks with hatch lines --------------------------------------
b = ""
for cx in (130, 470):
    b += f'<ellipse cx="{cx}" cy="100" rx="115" ry="62" fill="#ff9cbc" opacity="0.85"/>'
    for i in (-1, 0, 1):
        x = cx + i * 55
        b += f'<path d="M{x - 18},{130} L{x + 18},{70}" stroke="#ffffff" stroke-width="14"/>'
svg("blush", 30, 10, b, pad=6)

# --- tear: a chibi teardrop with a sad face ----------------------------------
d, tr = drop(0, 0, 105)
b = f'<g transform="translate(120,330)">' + shape(d, "#8fd3ff") + shine(-45, -40, 22, 34, 25) + "</g>"
svg("tear", 12, 24, b, pad=14)

# --- sweat: the classic big sweat drop ---------------------------------------
d, tr = drop(0, 0, 105)
b = f'<g transform="translate(165,340) rotate(-12)">' + shape(d, "#a8dcff") + shine(-45, -45, 22, 40, 20) + shine(30, 40, 12, 12, 0) + "</g>"
d2, _ = drop(0, 0, 30)
b += f'<g transform="translate(48,170) rotate(-25)">' + shape(d2, "#a8dcff", sw=10) + shine(-12, -10, 6, 10, 20) + "</g>"
svg("sweat", 14, 24, b, pad=14)

# --- vein: the anger mark ----------------------------------------------------
b = ""
c = 200
for rot in (0, 90, 180, 270):
    arm = (f"M{c-40},{c-150} C{c-30},{c-90} {c-55},{c-60} {c-150},{c-45} "
           f"L{c-150},{c-10} C{c-60},{c-20} {c-10},{c-30} {c-5},{c-150} Z")
    b += f'<g transform="rotate({rot} {c} {c})">' + shape(arm, "#ff4d5e", sw=SW) + "</g>"
svg("vein", 20, 20, b, pad=14)

# --- impact: a round comic pop -----------------------------------------------
pts = []
n = 14
for i in range(n * 2):
    r = 230 if i % 2 == 0 else 150
    a = math.pi * i / n - math.pi / 2
    pts.append((240 + r * math.cos(a), 240 + r * math.sin(a)))
d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts) + " Z"
b = shape(d, "#ffb238", sw=SW * 1.2)
pts2 = [(240 + (150 if i % 2 == 0 else 100) * math.cos(math.pi * i / n - math.pi / 2),
         240 + (150 if i % 2 == 0 else 100) * math.sin(math.pi * i / n - math.pi / 2)) for i in range(n * 2)]
b += '<path d="M' + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts2) + ' Z" fill="#fff07a"/>'
b += f'<circle cx="240" cy="240" r="62" fill="#ffffff"/>'
svg("impact", 24, 24, b, pad=14)

# --- shock: surprise lines around a centre -----------------------------------
b = ""
for i in range(12):
    a = 2 * math.pi * i / 12
    r1, r2 = (95, 150) if i % 2 == 0 else (110, 145)
    x1, y1 = 160 + r1 * math.cos(a), 160 + r1 * math.sin(a)
    x2, y2 = 160 + r2 * math.cos(a), 160 + r2 * math.sin(a)
    b += tube(f"M{x1:.1f},{y1:.1f} L{x2:.1f},{y2:.1f}", "#fff6c2", 16, sw=8)
svg("shock", 16, 16, b, pad=14)

# --- petals: scattered sakura petals -----------------------------------------
pet = "M0,-60 C35,-55 48,-10 30,25 C18,48 0,58 0,58 C0,58 -18,48 -30,25 C-48,-10 -35,-55 -8,-60 L0,-48 Z"
b = ""
for x, y, rot, s in ((90, 90, -30, 1.0), (330, 110, 25, 1.2), (220, 230, 70, 0.9), (100, 360, 140, 1.1), (360, 370, -60, 1.0), (240, 420, 10, 0.7)):
    b += f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">' + shape(pet, "#ffb3cc", sw=SW / s) + \
         f'<path d="M0,-30 L0,25" stroke="#ff8fb3" stroke-width="{6/s}"/></g>'
svg("petals", 24, 24, b, pad=14)

# --- flower: a smiling sakura ------------------------------------------------
b = ""
fx, fy = 180, 200
for i in range(5):
    a = i * 72
    b += f'<g transform="rotate({a} {fx} {fy})">' + shape(
        f"M{fx},{fy} C{fx-95},{fy-60} {fx-70},{fy-175} {fx-12},{fy-170} L{fx},{fy-150} L{fx+12},{fy-170} "
        f"C{fx+70},{fy-175} {fx+95},{fy-60} {fx},{fy} Z", "#ffd0e0") + "</g>"
b += f'<circle cx="{fx}" cy="{fy}" r="62" fill="#ffe27a" stroke="{OUT}" stroke-width="{SW}"/>'
b += tube(f"M{fx},{fy+70} Q{fx+10},{fy+160} {fx-5},{fy+235}", "#8fdc8f", 18, sw=10)
b += shape(f"M{fx+4},{fy+170} C{fx+50},{fy+120} {fx+100},{fy+140} {fx+110},{fy+150} C{fx+80},{fy+195} {fx+30},{fy+200} {fx+4},{fy+170} Z", "#a6e8a0", sw=10)
svg("flower", 18, 22, b, pad=14)

# --- notes: two bouncing music notes -----------------------------------------
b = ""
def note(x, y, s, fill):
    head = f'<ellipse cx="{x}" cy="{y}" rx="{55*s}" ry="{42*s}" transform="rotate(-20 {x} {y})" fill="{fill}" stroke="{OUT}" stroke-width="{SW}"/>'
    stem = tube(f"M{x+44*s},{y-15*s} L{x+44*s},{y-230*s}", fill, 16 * s, sw=SW * 0.8)
    flag = tube(f"M{x+44*s},{y-230*s} Q{x+120*s},{y-200*s} {x+110*s},{y-120*s}", fill, 16 * s, sw=SW * 0.8)
    return stem + flag + head + shine(x - 18 * s, y - 14 * s, 12 * s, 7 * s, -20)
b += note(100, 380, 1.0, "#ffb3d1") + note(225, 300, 0.85, "#c9b8ff")
b += shape(heart(250, 420, 30), "#ff7aa8", sw=9)
svg("notes", 16, 24, b, pad=14)

# --- zzz: sleepy letters and a bubble ----------------------------------------
def zee(x, y, s):
    d = f"M{x},{y} L{x+s},{y} L{x},{y+s} L{x+s},{y+s}"
    return tube(d, "#b9b4ff", s * 0.32, sw=SW * 0.9)
b = zee(40, 190, 110) + zee(190, 110, 80) + zee(305, 40, 55)
b += blobs([(345, 230, 34)], "#e6f4ff") + shine(335, 220, 9, 6, -30)
svg("zzz", 20, 16, b, pad=14)

print("ok", len(os.listdir("svg")))
