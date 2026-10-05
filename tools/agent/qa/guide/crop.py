# Cut every whole-window capture that has a <name>.json crop beside it; the result replaces the capture.
import glob, json, os, sys
from PIL import Image

d = sys.argv[1] if len(sys.argv) > 1 else 'shots094'
for j in sorted(glob.glob(os.path.join(d, '*.json'))):
    png = j[:-5] + '.png'
    c = json.load(open(j))
    im = Image.open(png)
    box = (int(c['x']), int(c['y']), int(c['x'] + c['width']), int(c['y'] + c['height']))
    if im.size == (box[2] - box[0], box[3] - box[1]):
        print('already cut', png); continue
    im.crop(box).save(png)
    os.remove(j)
    print('cut', png, box)
for f in sorted(glob.glob(os.path.join(d, '*.png'))):
    print(os.path.basename(f), Image.open(f).size)
