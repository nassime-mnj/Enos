from mobile_common import *
with sync_playwright() as pw:
    b, ctx = launch(pw, bypass_csp=True); errs=[]
    pg = ctx.new_page(); pg.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300])); pg.on("console", lambda m: print("CONSOLE", m.text[:200]) if m.type=="error" else None)
    pg.goto(URL); pg.wait_for_selector("#tabbar"); open_tool(pg,"cloud")
    pg.fill("#cl-url","http://127.0.0.1:8800"); pg.dispatch_event("#cl-url","change"); pg.wait_for_timeout(300)
    print(pg.evaluate("localStorage.getItem('enos.devvault')"))
    pg.fill("#cl-mail","ami@example.com"); pg.fill("#cl-pw","Un-bon-mot-de-passe-42"); pg.click("#cl-go"); pg.wait_for_timeout(3000)
    print("ERR:", pg.inner_text("#cl-err") if pg.locator("#cl-err:not([hidden])").count() else "(none)")
    b.close()
