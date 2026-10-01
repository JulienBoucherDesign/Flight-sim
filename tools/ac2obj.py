"""Convertisseur minimal AC3D (.ac) vers Wavefront OBJ, suffisant pour les meshs CRRCsim et FlightGear.

Usage : python3 tools/ac2obj.py chemin/vers/modele.ac [...]
Les meshs CRRCsim sont en pieds : multiplier par 0.3048 au chargement dans Three.js.
"""
import sys, math

def parse(path):
    toks = open(path, encoding="latin-1").read().split("\n")
    i = 0
    objs = []  # (name, verts, surfs, loc)
    stack = []
    def num(s): return float(s)
    verts = []; surfs = []; name = "obj"; loc = (0.0, 0.0, 0.0)
    while i < len(toks):
        line = toks[i].strip(); i += 1
        if not line: continue
        parts = line.split()
        kw = parts[0]
        if kw == "OBJECT":
            if verts or surfs:
                objs.append((name, verts, surfs, loc))
            verts = []; surfs = []; name = parts[1]; loc = (0.0, 0.0, 0.0)
        elif kw == "name":
            name = line.split(None, 1)[1].strip('"')
        elif kw == "loc":
            loc = tuple(num(p) for p in parts[1:4])
        elif kw == "numvert":
            n = int(parts[1])
            for _ in range(n):
                v = toks[i].split(); i += 1
                verts.append(tuple(num(x) for x in v[:3]))
        elif kw == "numsurf":
            n = int(parts[1])
            for _ in range(n):
                while not toks[i].strip().startswith("SURF"): i += 1
                i += 1
                refs = None
                while refs is None:
                    l = toks[i].strip(); i += 1
                    if l.startswith("refs"): refs = int(l.split()[1])
                idx = []
                for _ in range(refs):
                    idx.append(int(toks[i].split()[0])); i += 1
                if len(idx) >= 3: surfs.append(idx)
    if verts or surfs:
        objs.append((name, verts, surfs, loc))
    return objs

def write_obj(objs, out):
    off = 1; nf = 0
    with open(out, "w") as f:
        for name, verts, surfs, loc in objs:
            if not surfs: continue
            f.write(f"o {name}\n")
            for v in verts:
                f.write(f"v {v[0]+loc[0]:.5f} {v[1]+loc[1]:.5f} {v[2]+loc[2]:.5f}\n")
            for s in surfs:
                f.write("f " + " ".join(str(off + k) for k in s) + "\n"); nf += 1
            off += len(verts)
    return off - 1, nf

for src in sys.argv[1:]:
    objs = parse(src)
    out = src.rsplit("/", 1)[-1].replace(".ac", ".obj")
    nv, nf = write_obj(objs, out)
    xs = [v[0]+o[3][0] for o in objs for v in o[1]]; ys = [v[1]+o[3][1] for o in objs for v in o[1]]; zs=[v[2]+o[3][2] for o in objs for v in o[1]]
    print(f"{out}: {len([o for o in objs if o[2]])} objets, {nv} sommets, {nf} faces, bbox x={max(xs)-min(xs):.2f} y={max(ys)-min(ys):.2f} z={max(zs)-min(zs):.2f}")
