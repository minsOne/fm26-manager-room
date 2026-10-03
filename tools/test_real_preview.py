#!/usr/bin/env python3
"""Browser regression suite using synthetic real-shaped data, never a claimed FM integration test."""
import argparse
import copy
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]

def fixture():
    return {"schemaVersion":2,"source":"rust-native","saveName":"Browser test.fm","gameDate":"2037-07-01",
      "manager":{"clubUid":45,"club":"Test FC","name":"Coach"},
      "players":[{"id":"7","name":"Young Player","age":18,"ca":125,"pa":125,"paKnown":False,
        "positions":["CM"],"attributes":{"passing":14},"hidden":{"professionalism":17},
        "fitness":{"condition":100,"fatigue":0,"fatigueKnown":False,"injuryRisk":0,"injuryRiskKnown":False},
        "playingTime":{"recentMinutes":0,"recentMinutesKnown":False},"contract":{"weeklyWage":0,"end":None}}],
      "fixtures":[{"id":"m1","date":"2037-07-02","opponent":"Next FC","home":True,"competitionKnown":False},
        {"id":"m2","date":"2037-07-07","opponent":"Later FC","home":False,"competitionKnown":False}]}

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--executable")
    parser.add_argument("--screenshot-dir",type=Path)
    args=parser.parse_args()
    server=ThreadingHTTPServer(("127.0.0.1",0),partial(QuietHandler,directory=str(ROOT/"apps/web")))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    payload=fixture(); state={"snapshot":payload,"fail":False,"parserError":None}
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=args.executable,headless=True,args=["--no-sandbox"])
        page=browser.new_page(viewport={"width":1440,"height":1000}); errors=[]
        page.on("pageerror",lambda e: errors.append(str(e)))
        def bridge(route):
            if state["fail"]: route.abort(); return
            data={"parsing":False,"lastError":state["parserError"]} if route.request.url.endswith("/api/parser") else state["snapshot"]
            route.fulfill(status=200,content_type="application/json",body=json.dumps(data),headers={"Access-Control-Allow-Origin":"*"})
        page.route("http://127.0.0.1:8765/**",bridge)
        page.goto(f"http://127.0.0.1:{server.server_port}/index.html")
        page.get_by_text("실제 세이브",exact=True).wait_for()
        print("PASS real schema loads without implicit demo")
        for view in ["manager","squad","matchday","tactics","training","development","medical","recruitment","transfers","contracts","economy","reports","coach","settings"]:
            page.locator(f'nav [data-view="{view}"]').click()
            assert not any(x in page.locator("#content").inner_text() for x in ["NaN","undefined","Infinity"])
        print("PASS all 14 tabs handle partial/empty datasets")
        page.locator('nav [data-view="medical"]').click()
        assert "판단 보류" in page.locator("#content").inner_text()
        assert "미확인" in page.locator("#content").inner_text()
        print("PASS medical unknowns are review, not START or zero risk")
        page.locator('nav [data-view="tactics"]').click()
        page.locator("#formationSelect").select_option("4-2-3-1")
        page.locator('button[data-player="7"]').click()
        page.locator("#searchInput").fill("Young")
        state["snapshot"]=copy.deepcopy(payload); state["snapshot"]["players"][0]["ca"]=127
        page.locator("#refreshButton").click()
        page.wait_for_function("!document.querySelector('#refreshButton').disabled")
        assert page.locator("#formationSelect").input_value()=="4-2-3-1"
        assert page.locator("#searchInput").input_value()=="Young"
        assert "Young Player" in page.locator("#selectedPlayer").inner_text()
        assert page.locator('nav [aria-current="page"]').get_attribute("data-view")=="tactics"
        print("PASS refresh retains tab, player, search and formation")
        page.locator('nav [data-view="matchday"]').click()
        page.locator("#fixtureSelect").select_option("m2")
        page.locator("#rotationModeSelect").select_option("protect")
        assert page.locator("#rotationModeSelect").input_value()=="protect"
        plan_panel=page.locator("section.panel").filter(has=page.get_by_role("heading",name="향후 최대 5경기 로테이션 · 계획 시나리오",exact=True))
        assert "Later FC" in plan_panel.inner_text() and "Next FC" not in plan_panel.inner_text()
        print("PASS selected fixture immediately anchors the rendered rotation plan")
        state["snapshot"]["players"][0]["ca"]=128
        page.locator("#refreshButton").click()
        page.wait_for_function("document.querySelector('#fixtureSelect')?.value === 'm2' && !document.querySelector('#refreshButton').disabled")
        assert page.locator("#fixtureSelect").input_value()=="m2"
        assert page.locator("#rotationModeSelect").input_value()=="protect"
        print("PASS refresh retains selected fixture and rotation mode")
        state["snapshot"]["fixtures"]=state["snapshot"]["fixtures"][:1]
        page.locator("#refreshButton").click()
        page.wait_for_function("document.querySelector('#content').textContent.includes('선택한 경기가 최신 스냅샷')")
        assert page.locator("#fixtureSelect").input_value()==""
        assert page.get_by_role("heading",name="향후 최대 5경기 로테이션 · 계획 시나리오",exact=True).count()==0
        state["snapshot"]["fixtures"]=copy.deepcopy(payload["fixtures"])
        page.locator("#refreshButton").click()
        page.wait_for_function("document.querySelector('#fixtureSelect')?.value === 'm2' && !document.querySelector('#refreshButton').disabled")
        print("PASS missing selected fixture defers instead of silently switching")
        state["fail"]=True; page.locator("#refreshButton").click()
        page.get_by_text("이전 정상 데이터 유지",exact=True).wait_for()
        assert page.locator("#fixtureSelect").input_value()=="m2"
        assert "Later FC" in page.locator("#content").inner_text()
        assert "데모" not in page.locator("#syncStatus").inner_text()
        print("PASS disconnect keeps last good snapshot with stale warning")
        state["fail"]=False;state["parserError"]="synthetic parser failure";page.locator("#refreshButton").click()
        page.get_by_text("synthetic parser failure",exact=True).wait_for()
        print("PASS parser failure visible despite HTTP 200 snapshot")
        state["parserError"]=None;state["snapshot"]={**payload,"saveName":"Other career.fm"}
        page.locator("#refreshButton").click();page.get_by_text("다른 세이브 전환 보류",exact=True).wait_for()
        page.locator("[data-accept-career]").click()
        assert "Other career.fm" in page.locator("#syncStatus").inner_text()
        assert page.locator("#rotationModeSelect").input_value()=="balanced"
        print("PASS new career needs explicit acceptance")
        state["snapshot"]=copy.deepcopy(state["snapshot"])
        state["snapshot"]["players"][0]["name"]='<img src=x onerror="window.PWNED=true">'
        page.locator('nav [data-view="squad"]').click()
        page.locator("#refreshButton").click()
        page.wait_for_function("document.querySelector('#content').textContent.includes('<img')")
        assert page.locator("#content img").count()==0
        assert page.evaluate("window.PWNED") is None
        print("PASS injected player text is escaped, not executed")
        state["snapshot"]=fixture();state["snapshot"]["saveName"]="Other career.fm"
        page.locator("#refreshButton").click()
        page.wait_for_function("!document.querySelector('#refreshButton').disabled")
        page.locator('nav [data-view="manager"]').click()
        if args.screenshot_dir:
            args.screenshot_dir.mkdir(parents=True,exist_ok=True)
            page.screenshot(path=str(args.screenshot_dir/"desktop.png"),full_page=True)
        page.set_viewport_size({"width":390,"height":844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        if args.screenshot_dir:page.screenshot(path=str(args.screenshot_dir/"mobile.png"),full_page=True)
        assert errors==[],errors
        print("PASS mobile layout has no page-level overflow; no JavaScript exceptions")
        demo=browser.new_page(); demo_calls=[]
        demo.route("http://127.0.0.1:8765/**",lambda route:(demo_calls.append(route.request.url),route.abort()))
        demo.goto(f"http://127.0.0.1:{server.server_port}/demo.html")
        demo.locator("button.nav").first.wait_for()
        assert demo_calls==[],demo_calls
        print("PASS explicit legacy demo never reads real Bridge data")
        browser.close()
    server.shutdown()

if __name__=="__main__":main()
