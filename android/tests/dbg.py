from mobile_common import *
with sync_playwright() as pw:
    b, ctx = launch(pw)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: print("PAGEERROR", str(e)[:300]))
    pg.goto(URL); pg.wait_for_timeout(2500)
    print(pg.evaluate("[document.querySelectorAll('.suite-sec').length, document.querySelectorAll('.tool').length, document.querySelector('#tools-home')&&document.querySelector('#tools-home').outerHTML.length, document.querySelector('#tile-text')&&document.querySelector('#tile-text').parentElement.parentElement.className]"))
    print(pg.evaluate("(()=>{const t=document.querySelector('#tile-text'); if(!t) return 'none'; const r=t.getBoundingClientRect(); const v=document.querySelector('.view[data-v=tools]'); return [r.width,r.height,getComputedStyle(t).display, v.getBoundingClientRect().left, getComputedStyle(document.querySelector('#tools-home')).display]})()"))
    b.close()
