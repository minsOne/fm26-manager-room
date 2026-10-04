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
        "positions":["CM","DM"],"positionRatings":{"MC":20,"DM":20},
        "attributes":{key:14 for key in ["passing","vision","firstTouch","technique","decisions","composure","positioning","anticipation","stamina","workRate","offTheBall"]},
        "hidden":{"professionalism":17},
        "fitness":{"condition":100,"fatigue":0,"fatigueKnown":False,"injuryRisk":0,"injuryRiskKnown":False},
        "playingTime":{"recentMinutes":0,"recentMinutesKnown":False,"matchesKnown":True,"historyComplete":False,
          "minutesInterpretationVerified":False,"matches":[
            *[{"date":f"2037-06-{day}","opponentTeamId":100,"competitionId":12,"minutes":90,"minutesKnown":True} for day in [23,24,25,26]],
            {"date":"2037-06-30","opponentTeamId":100,"competitionId":12,"minutes":None,"minutesKnown":False},
            {"date":"2037-07-01","opponentTeamId":100,"competitionId":12,"minutes":0,"minutesKnown":True}]},"contract":{"weeklyWage":0,"end":None}}],
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
        assert '날짜별 경기 기록' in page.locator('#selectedPlayer').inner_text()
        assert '2037-06-30' in page.locator('#selectedPlayer').inner_text()
        assert '전체 출전량은 미확인' in page.locator('#selectedPlayer').inner_text()
        print("PASS refresh retains tab, player, search, formation and dated history")
        page.locator('nav [data-view="matchday"]').click()
        page.locator("#fixtureSelect").select_option("m2")
        page.locator("#rotationModeSelect").select_option("protect")
        assert page.locator("#rotationModeSelect").input_value()=="protect"
        plan_panel=page.locator("section.panel").filter(has=page.get_by_role("heading",name="향후 최대 5경기 로테이션 · 계획 시나리오",exact=True))
        assert "Later FC" in plan_panel.inner_text() and "Next FC" not in plan_panel.inner_text()
        history_panel=page.locator('section.panel').filter(has=page.get_by_role('heading',name='경기일 기준 수록 출전량 · 최근 14일',exact=True))
        assert '270' in history_panel.inner_text() and '2037-06-24' in history_panel.inner_text()
        page.locator('#fixtureSelect').select_option('m1')
        assert '360' in history_panel.inner_text() and '2037-06-19' in history_panel.inner_text()
        page.locator('#fixtureSelect').select_option('m2')
        assert '270' in history_panel.inner_text()
        print("PASS selected fixture anchors dated workload and drops expired observations")
        page.locator('#lock-rdm').select_option('7')
        assert '감독 고정' in page.locator('#content').inner_text()
        page.locator('details[data-rest-controls] summary').click()
        page.locator('input[data-rest-player="7"]').check()
        page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).wait_for()
        assert page.locator('#lock-rdm').input_value()=='7'
        assert page.locator('input[data-rest-player="7"]').is_checked()
        page.locator('input[data-rest-player="7"]').uncheck()
        assert page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count()==0
        assert '감독 고정' in page.locator('#content').inner_text()
        page.locator('#fixtureSelect').select_option('m1')
        assert page.locator('#lock-rdm').input_value()==''
        page.locator('#fixtureSelect').select_option('m2')
        assert page.locator('#lock-rdm').input_value()=='7'
        print("PASS hard lock/rest conflict is explicit, resolvable and isolated per fixture")
        # Add a same-role synthetic backup only for minute-plan interaction coverage.
        backup=copy.deepcopy(state["snapshot"]["players"][0]); backup["id"]="8"; backup["name"]="Backup Player"
        state["snapshot"]["players"].append(backup)
        page.locator('#refreshButton').click()
        page.wait_for_function("document.querySelector('#sub-player-rdm option[value=\"8\"]') && !document.querySelector('#refreshButton').disabled")
        page.locator('details[data-minute-controls] summary').click()
        page.locator('input[data-minute-cap-player="7"]').fill('60')
        page.locator('input[data-minute-cap-player="7"]').dispatch_event('change')
        page.locator('#sub-player-rdm').select_option('8')
        page.locator('#sub-minute-rdm').fill('60')
        page.locator('#sub-minute-rdm').dispatch_event('change')
        assert page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count()==0
        assert page.get_by_role('heading',name='교체 계획 보류',exact=True).count()==0
        minute_panel=page.locator('section.panel').filter(has=page.get_by_role('heading',name='출전시간·교체 계획 · 90분 시나리오',exact=True))
        assert 'Backup Player' in minute_panel.inner_text() and '30' in minute_panel.inner_text()
        rule=page.locator('input[data-match-rule="substitutionLimit"]')
        rule.fill('0');rule.dispatch_event('change')
        page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).wait_for()
        rule.fill('1');rule.dispatch_event('change')
        assert page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count()==0
        bench_rule=page.locator('input[data-match-rule="benchLimit"]')
        bench_rule.fill('0');bench_rule.dispatch_event('change')
        page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).wait_for()
        bench_rule.fill('1');bench_rule.dispatch_event('change')
        assert page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count()==0
        page.locator('#sub-minute-rdm').fill('70');page.locator('#sub-minute-rdm').dispatch_event('change')
        page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).wait_for()
        page.locator('#sub-minute-rdm').fill('60');page.locator('#sub-minute-rdm').dispatch_event('change')
        page.locator('#fixtureSelect').select_option('m1')
        assert page.locator('input[data-match-rule="substitutionLimit"]').input_value()==''
        assert page.locator('input[data-minute-cap-player="7"]').input_value()==''
        page.locator('#fixtureSelect').select_option('m2')
        assert page.locator('input[data-minute-cap-player="7"]').input_value()=='60'
        page.locator('#refreshButton').click();page.wait_for_function("!document.querySelector('#refreshButton').disabled")
        assert page.locator('details[data-minute-controls]').evaluate('(panel)=>panel.open')
        assert page.locator('input[data-match-rule="substitutionLimit"]').input_value()=='1'
        assert page.locator('input[data-match-rule="benchLimit"]').input_value()=='1'
        print('PASS manual rule limits, zero conflicts, fixture isolation and refresh retention')
        assert page.locator('#sub-player-rdm').input_value()=='8'
        assert page.locator('#sub-minute-rdm').input_value()=='60'
        page.locator('input[data-minute-cap-player="7"]').fill('');page.locator('input[data-minute-cap-player="7"]').dispatch_event('change')
        page.locator('#sub-player-rdm').select_option('')
        page.locator('#sub-minute-rdm').fill('');page.locator('#sub-minute-rdm').dispatch_event('change')
        state["snapshot"]["players"]=state["snapshot"]["players"][:1]
        print("PASS minute cap/substitution split, cap conflict, fixture isolation and refresh retention")
        state["snapshot"]["players"][0]["ca"]=128
        page.locator("#refreshButton").click()
        page.wait_for_function("document.querySelector('#fixtureSelect')?.value === 'm2' && !document.querySelector('#refreshButton').disabled")
        assert page.locator("#fixtureSelect").input_value()=="m2"
        assert page.locator("#rotationModeSelect").input_value()=="protect"
        assert page.locator('#lock-rdm').input_value()=='7'
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
        state["snapshot"]["players"]=[]
        page.locator('#refreshButton').click()
        page.wait_for_function("document.querySelector('#content').textContent.includes('고정 선수 UID 7가 최신 스냅샷')")
        assert page.locator('#lock-rdm').input_value()=='7'
        state["snapshot"]["players"]=copy.deepcopy(payload["players"])
        page.locator('#refreshButton').click()
        page.wait_for_function("!document.querySelector('#refreshButton').disabled")
        assert page.get_by_role('heading',name='선택 충돌 · 배치 보류',exact=True).count()==0
        print("PASS disappearing locked player causes conflict without replacing the retained directive")
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
        assert all(value=='' for value in page.locator('select[data-lock-slot]').evaluate_all('(fields)=>fields.map(f=>f.value)'))
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
