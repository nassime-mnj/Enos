import sys, json, os
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),"..","..",".."))
sys.path.insert(0,os.path.join(ROOT,"dualpulse_site"))
from app.launcher import tokens
k=tokens.new_private()
open("/tmp/dpl_e2e_priv","w").write(tokens.private_to_b64(k))
open("/tmp/dpl_e2e_env","w").write(f"""export DP_DB=/tmp/dpl_e2e/t.db
export DP_ADMIN_TOKEN=jeton-admin-e2e-123
export DP_ADMIN_PATH=admin-dp
export DP_STORAGE_DIR=/tmp/dpl_e2e/store
export DP_MANIFEST_PUBKEY={tokens.public_b64(k)}
export DP_LAUNCHER_ORIGINS=http://127.0.0.1:8801,http://127.0.0.1:8802
""")
