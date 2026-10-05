# A contact sheet of the named pictures of a folder. usage: python sheet.py <dir> <out.png> <cols> <cellW> <cellH> name [name…]
import os, sys
from PIL import Image, ImageDraw

d, out, cols, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
names = sys.argv[6:]
rows = (len(names) + cols - 1) // cols
sheet = Image.new('RGB', (W * cols, H * rows), (225, 225, 225))
draw = ImageDraw.Draw(sheet)
for k, name in enumerate(names):
    f = os.path.join(d, name + '.png')
    x, y = (k % cols) * W, (k // cols) * H
    draw.rectangle([x, y, x + W - 1, y + 22], fill=(40, 40, 60))
    if not os.path.exists(f):
        draw.text((x + 6, y + 5), name + '  (MISSING)', fill=(255, 120, 120)); continue
    im = Image.open(f).convert('RGB')
    full = im.size
    im.thumbnail((W - 12, H - 30))
    sheet.paste(im, (x + 6, y + 26))
    draw.text((x + 6, y + 5), '%s  %dx%d' % (name, full[0], full[1]), fill=(255, 255, 255))
sheet.save(out)
print(out, sheet.size)
