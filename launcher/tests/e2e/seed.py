import sys, json, os, hashlib, urllib.request
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"..","..",".."))
sys.path.insert(0,os.path.join(ROOT,"dualpulse_site"))
from app.launcher import tokens, manifests
priv=tokens.private_from_b64(open("/tmp/dpl_e2e_priv").read())
B="http://127.0.0.1:8800"; ADM={"X-Admin-Token":"jeton-admin-e2e-123","Content-Type":"application/json"}
def req(path,body=None,headers=None,method=None):
    r=urllib.request.Request(B+path,data=json.dumps(body).encode() if body is not None else None,headers=headers or {"Content-Type":"application/json"},method=method or ("POST" if body is not None else "GET"))
    return json.load(urllib.request.urlopen(r))
req("/admin-dp/api/launcher/ceo",{"email":"ceo@dualpulse.test","password":"Un-bon-mot-de-passe-42"},ADM)
store="/tmp/dpl_e2e/store"
def release(product,channel,version,content,notes):
    key=f"{product}/{channel}/{version}/Setup.exe"; os.makedirs(os.path.dirname(f"{store}/{key}"),exist_ok=True); open(f"{store}/{key}","wb").write(content)
    m={"product":product,"channel":channel,"version":version,"released":"2026-10-20","notes":notes,"min_launcher":"1.0.0","launch":"Setup.exe","silent_args":"/SILENT","run":"ENOS.exe","app_id":"{6F1E2B7A-4C3D-4E8B-9A57-E905A1C0D3B2}",
       "files":[{"path":"Setup.exe","sha256":hashlib.sha256(content).hexdigest(),"size":len(content),"key":key}]}
    req("/admin-dp/api/launcher/releases",{"manifest":m,"signature":manifests.sign(priv,m)},ADM)
release("enos","stable","3.1.0",b"MZ-STABLE-"+b"s"*200000,"3.1.0 (stable)\n- Agenda : timeline et glisser-déposer\n- Profils CEO / Dev / Friends")
release("enos","dev","3.2.0",b"MZ-DEV-"+b"d"*200000,"3.2.0 (dev)\n- Éditions isolées")
release("enos","ceo","3.3.0",b"MZ-CEO-"+b"c"*200000,"3.3.0 (ceo)\n- Notes de frais")
release("terna","alpha","0.1.0",b"MZ-TERNA-ALPHA"+b"t"*50000,"Alpha 0.1.0")
c=req("/launcher/v1/auth/login",{"email":"ceo@dualpulse.test","password":"Un-bon-mot-de-passe-42"})
H={"Content-Type":"application/json","Authorization":"Bearer "+c["access_token"]}
req("/launcher/v1/news",{"title":"Mise à jour d'E.N.O.S. 3.1","body":"Agenda refondu : timeline, magnétisme, urgence en couleur.","kind":"release","priority":5},H)
req("/launcher/v1/news",{"title":"Annonce du studio","body":"Dual Pulse recrute des testeurs.","kind":"announcement","image":"","min_role":"public"},H)
req("/launcher/v1/news",{"title":"Note équipe Dev","body":"Réunion vendredi.","kind":"news","min_role":"dev","priority":9},H)
print("seed ok")
