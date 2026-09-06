import json, struct, sys
from pathlib import Path
import numpy as np

root=Path(sys.argv[1]) if len(sys.argv)>1 else Path(__file__).parent/'repaired_output'
total=0
paths=sorted(root.glob('*/model.glb'))
assert paths, 'No model.glb files found; pass public/models or run prepare_assets.py build first'
for path in paths:
    raw=path.read_bytes();magic,version,size=struct.unpack_from('<III',raw)
    assert (magic,version,size)==(0x46546c67,2,len(raw))
    jsize,jtype=struct.unpack_from('<II',raw,12)
    assert jtype==0x4e4f534a
    gltf=json.loads(raw[20:20+jsize]); off=20+jsize
    bsize,btype=struct.unpack_from('<II',raw,off); off+=8
    assert btype==0x004e4942 and off+bsize==len(raw)
    blob=memoryview(raw)[off:]
    def data(i):
        a=gltf['accessors'][i];v=gltf['bufferViews'][a['bufferView']]
        typ={5126:'<f4',5125:'<u4'}[a['componentType']];width={'SCALAR':1,'VEC3':3}[a['type']]
        return np.frombuffer(blob,dtype=typ,count=a['count']*width,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],width)
    for m in gltf['meshes']:
        for p in m['primitives']:
            v=data(p['attributes']['POSITION']);n=data(p['attributes']['NORMAL']);f=data(p['indices'])
            assert len(v)==len(n) and np.isfinite(v).all() and np.isfinite(n).all()
            assert f.max()<len(v) and len(f)%3==0
    nodes=gltf['nodes'];seen=set()
    def walk(i):
        assert i not in seen,'Cycle or shared node';seen.add(i)
        q=np.array(nodes[i].get('rotation',[0,0,0,1]));assert abs(np.linalg.norm(q)-1)<1e-5
        for c in nodes[i].get('children',[]):walk(c)
    walk(0);assert len(seen)==len(nodes)
    names=[n['name'] for n in nodes];assert len(names)==len(set(names))
    rig=json.loads(path.with_name('rig.json').read_text())
    for j in rig['joints'].values():assert j['node'] in names
    total+=len(raw)
    print(path.parent.name,'valid',len(nodes),'nodes',len(rig['joints']),'joints',len(raw),'bytes')
print('Total GLB bytes:',total)
