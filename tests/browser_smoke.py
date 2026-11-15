"""Optional intercepted-page Chromium smoke test (NOT live Amazon).
Requires Python Playwright: python tests/browser_smoke.py
"""
import asyncio
import tempfile
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
SEARCH_URL = 'https://www.jobsatamazon.co.uk/app#/jobSearch'

def search_html():
    return '''<!doctype html><title>Amazon Jobs</title><body>
    <h1>Job Search</h1>
    <button class="active" aria-selected="true">Recommended</button><button aria-selected="false">All</button>
    <h2>Recommended jobs for you</h2>
    <article class="job-card" role="listitem" onclick="document.querySelector('#listing').hidden=true;document.querySelector('#detail').hidden=false">
      <div id="listing">Within 0.2 mi | Peterborough, England <p>Type: Full Time</p> Warehouse Operative</div></article>
    <section id="detail" hidden><h2>Warehouse Operative</h2><button onclick="window.open('https://hiring.amazon.com/app?stage=next','_blank')">Apply</button></section>
    </body>'''

def button(name, next_stage):
    return f'<button onclick="location.href=\'?stage={next_stage}\'">{name}</button>'

def app_html(stage):
    pages = {
        'next': button('Next','start'),
        'start': button('Start Application','agree'),
        'agree': button('I Agree','shift'),
        'shift': '''<h2>Step 2 of 6</h2><article class="shift-card" onclick="location.href='?stage=detail'">
                    <p>Hours: 40hrs per week</p><p>Shift: Wed, Thu, Fri, Sat 7:00 - 17:30</p></article>
                    <button aria-label="Open menu" onclick="location.href='?stage=alljobs'">☰</button>''',
        'detail': button('Select this job','offer'),
        'offer': button('Accept Offer','offernext'),
        'offernext': button('Next','prehire'),
        'prehire': '<h2>Schedule pre-hire appointment</h2><p>Select a date and available time slot for your appointment.</p>',
        'alljobs': '<button onclick="location.href=\'https://www.jobsatamazon.co.uk/app#/jobSearch\'">See all jobs</button>'
    }
    return f'<title>Amazon Hiring Application</title><h1>Amazon Jobs</h1><main>{pages.get(stage,pages["next"])}</main>'

async def main():
    with tempfile.TemporaryDirectory() as user_dir:
      async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(user_dir, executable_path='/usr/bin/chromium', headless=True,
            args=[f'--disable-extensions-except={ROOT}', f'--load-extension={ROOT}','--no-sandbox','--ignore-certificate-errors'])
        async def route_handler(route):
            url=route.request.url
            if 'jobsatamazon.co.uk' in url:
                body=search_html()
            else:
                stage=parse_qs(urlparse(url).query).get('stage',['next'])[0]
                body=app_html(stage)
            await route.fulfill(status=200, content_type='text/html', body=body)
        await browser.route('https://www.jobsatamazon.co.uk/**',route_handler)
        await browser.route('https://hiring.amazon.com/**',route_handler)
        workers=browser.service_workers
        if not workers:
            worker=await browser.wait_for_event('serviceworker',timeout=15000)
        else: worker=workers[0]
        ext_id=urlparse(worker.url).netloc
        search=await browser.new_page()
        await search.goto(SEARCH_URL)
        popup=await browser.new_page()
        await popup.goto(f'chrome-extension://{ext_id}/popup.html')
        await popup.locator('#minHours').fill('40')
        await popup.locator('#maxHours').fill('40')
        await popup.locator('#days').fill('4')
        await popup.locator('#start').click()
        last='unknown';completed=False
        for _ in range(180):
            s=await popup.evaluate("async ()=>(await chrome.storage.session.get('session')).session||{}")
            last=f"{s.get('status')} / phase={s.get('phase')} / search={s.get('searchTabId')} / app={s.get('appTabId')}"
            if s.get('status')=='Completed':completed=True;break
            if str(s.get('status','')).startswith('Failed'):break
            await asyncio.sleep(.15)
        print('Browser fixture test:',last)
        print('Tabs:',[pg.url for pg in browser.pages])
        await browser.close()
        if not completed:raise AssertionError('Controller did not reach pre-hire completion on fixtures')

if __name__=='__main__':asyncio.run(main())
