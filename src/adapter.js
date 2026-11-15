/* Amazon page adapter. Only reports observations on explicitly enabled tabs.
   All DOM selectors are conservative candidates, NOT live-site validated. */
(()=>{
  'use strict';
  if(window.__amazonFullApplyAdapterReady)return;
  window.__amazonFullApplyAdapterReady=true;
  const roots=new Map(); let idCounter=0,enabled=false,timer=null,clockTimer=null,lastClick='',lastClickAt=0;
  let lastSignature='',generation=0;
  // Card reads are cached until the DOM changes. The liveness pulse does not
  // trigger another expensive scan when the visible page is unchanged.
  let cachedJobCards=[],jobCardsDirty=true,allowedClickIds=new Set();
  let lastCardScanMs=0;

  const textOf=e=>String(typeof e?.innerText==='string'?e.innerText:(e?.textContent||'')).replace(/\s+/g,' ').trim();
  const lower=s=>String(s||'').toLowerCase();
  function visible(el){
    if(!el || !el.isConnected || !el.getClientRects().length)return false;
    for(let e=el;e&&e.nodeType===1;e=e.parentElement){
      const st=getComputedStyle(e);
      if(st.display==='none'||st.visibility==='hidden'||st.visibility==='collapse'||Number(st.opacity)===0||e.hasAttribute('hidden')||e.getAttribute('aria-hidden')==='true'||e.inert)return false;
    }
    return true;
  }
  function enabledTarget(el){return visible(el)&&!el.matches(':disabled,[disabled],[aria-disabled="true"]');}
  function identify(el){
    for(const [id,e] of roots)if(e===el)return id;
    const id='e'+(++idCounter);roots.set(id,el);
    if(roots.size>1200){for(const [key,node] of roots)if(!node.isConnected)roots.delete(key);}
    return id;
  }
  function controls(){
    return [...document.querySelectorAll('button,a,[role="button"],[role="tab"],input[type="button"],input[type="submit"],label[for]')]
      .filter(enabledTarget).filter(e=>(e.innerText||'').length<180);
  }
  function getLabel(el){return String(el.getAttribute('aria-label')||el.value||textOf(el)||el.title||'').trim();}
  const labelAliases={
    apply:[/^apply(?: now)?$/i], next:[/^next$/i],start:[/^start application$/i],
    continue:[/^continue$/i],agree:[/^i agree$/i],selectJob:[/^select this job$/i],
    acceptOffer:[/^accept offer$/i],seeAllJobs:[/^see all jobs$/i],recommended:[/^recommended$/i]
  };
  function buttonMap(buttons){
    const out={};
    for(const [key,aliases] of Object.entries(labelAliases)){
      const e=buttons.find(el=>aliases.some(rx=>rx.test(getLabel(el))));
      if(e)out[key]=identify(e);
    }
    const menu=buttons.find(el=>{
      const l=getLabel(el).toLowerCase();
      if(/^(menu|open menu|navigation menu|open navigation|toggle navigation|☰|menu toggle)$/.test(l))return true;
      const details=[el.getAttribute('data-testid'),el.getAttribute('title'),el.getAttribute('id'),el.className].join(' ');
      if(/(?:hamburger|menu.?button|nav.?toggle|navigation.?menu)/i.test(details))return true;
      const svg=el.querySelector('svg');if(!svg)return false;
      const svgName=[svg.getAttribute('data-testid'),svg.getAttribute('aria-label'),svg.getAttribute('class')].join(' ');
      if(/(?:hamburger|menu|navigation)/i.test(svgName))return true;
      // Recognise a standard 3-horizontal-line hamburger drawn by SVG primitives.
      const paths=[...svg.querySelectorAll('path,line')];
      const horizontals=paths.filter(p=>{
        const d=p.getAttribute('d')||'';
        if(p.tagName.toLowerCase()==='line')return p.getAttribute('y1')===p.getAttribute('y2');
        return /[Mm]\s*\d+(?:\.\d+)?[ ,]+\d+(?:\.\d+)?\s*[Hh]\s*\d+/i.test(d)||
          /[Mm]\s*\d+[ ,]+\d+\s*[Ll]\s*\d+[ ,]+0/i.test(d);
      });
      return horizontals.length>=3;
    });
    if(menu)out.menu=identify(menu);
    // The observed Step-2 page has a top-left Amazon Jobs brand link,
    // rather than a reliably detectable hamburger navigation button.
    // Match the brand's own visible, interactive element; do not scan/click
    // arbitrary page text or an unrelated Amazon-branded link in the body.
    const brand=buttons.find(el=>{
      if(!el.matches('a[href],button,[role="button"],[role="link"]'))return false;
      const rect=el.getBoundingClientRect();
      if(rect.width<20||rect.height<12||rect.left<0||rect.top<0||
         rect.left>Math.min(window.innerWidth*.45,470)||rect.top>Math.min(window.innerHeight*.48,340))return false;
      const img=el.querySelector('img'),svg=el.querySelector('svg');
      const evidence=[getLabel(el),el.getAttribute('title'),el.getAttribute('data-testid'),
        el.getAttribute('id'),el.getAttribute('class'),img?.alt,
        (img?.getAttribute('src')||'').replace(/^(?:https?:)?\/\/[^/]+/i,''),
        svg?.getAttribute('aria-label'),svg?.querySelector('title')?.textContent].filter(Boolean).join(' ');
      const explicitlyBranded=/(?:amazon\s*jobs|amazonjobs|jobsatamazon)/i.test(evidence);
      const inHeader=!!el.closest('header,[role="banner"],nav,[class*="header" i]');
      const logoStyle=/(?:logo|navbar.?brand|site.?brand)/i.test(evidence);
      if(!explicitlyBranded&&!(inHeader&&logoStyle&&(img||svg)))return false;
      // Avoid chasing off-site or javascript: anchors masquerading as the logo.
      const href=el.getAttribute('href');
      if(href){
        try{
          const u=new URL(href,location.href);
          if(u.protocol!=='https:'&&u.protocol!=='http:')return false;
          if(!/(^|\.)(jobsatamazon\.co\.uk|amazon\.jobs)$/.test(u.hostname))return false;
        }catch{return false;}
      }
      return true;
    });
    if(brand)out.homeLogo=identify(brand);
    return out;
  }
  function activeRecommended(buttons, hasRecommendedResults=false){
    const rec=buttons.find(e=>/^recommended$/i.test(getLabel(e))),all=buttons.find(e=>/^all$/i.test(getLabel(e)));
    const attr=(e)=>e?.getAttribute('aria-selected')==='true'||e?.getAttribute('aria-pressed')==='true'||
      e?.getAttribute('data-state')==='active'||/(?:^|[\s_-])(active|selected)(?:$|[\s_-])/i.test(String(e?.className||''));
    if(attr(rec))return 'yes';if(attr(all))return 'no';
    if(!rec)return hasRecommendedResults?'yes':'unknown';
    // Many Amazon tabs are pills; recognise the dark-selected pill only if contrast is unambiguous.
    const luminance=e=>{const m=getComputedStyle(e).backgroundColor.match(/\d+(?:\.\d+)?/g);if(!m||m.length<3)return null;const [r,g,b,a]=m.map(Number);if(a===0)return 255;return .2126*r+.7152*g+.0722*b;};
    if(all){const a=luminance(rec),b=luminance(all);if(a!==null&&b!==null&&Math.abs(a-b)>75)return a<b?'yes':'no';}
    // Some Amazon pill buttons have no aria-selected / selected class, and
    // their dark background is painted by an inner wrapper. The visible
    // 'Recommended jobs for you' section plus recognised cards confirms the
    // Recommended results view, unless All is explicitly selected above.
    if(hasRecommendedResults)return 'yes';
    return 'unknown';
  }
  function findContainers(selectors){
    const nodes=[];for(const el of document.querySelectorAll(selectors)){
      if(visible(el)&&!nodes.includes(el))nodes.push(el);
      if(nodes.length>2000)break;
    }return nodes;
  }
  function parseMiles(s){const m=s.match(/\b(?:within|distance(?:\s*from\s*you)?\s*:?|approximately)\s*(\d+(?:\.\d+)?)\s*(?:mi\b|miles?\b)/i)||s.match(/\b(\d+(?:\.\d+)?)\s*(?:mi\b|miles?\b)/i);return m?Number(m[1]):null;}
  function extractLocation(s){
    const combined=s.match(/\bWithin\s*\d+(?:\.\d+)?\s*mi\s*[|·\-]\s*([\w .,'’()\/-]+?)(?=\s+(?:Type|Hours|Pay|Shift|Posted|Apply|£|\d+(?:\.\d+)?\s*mi)|$)/i);
    if(combined)return combined[1].trim();
    const place=s.match(/\b([A-Z][A-Za-z'’().\- ]{2,65},\s*(?:England|Scotland|Wales|Northern Ireland|UK|United Kingdom))\b/i);
    if(place)return place[1].trim();
    return /Multiple On Site locations available/i.test(s)?'Multiple On Site locations available':'';
  }
  function parseEmployment(s){const m=s.match(/\b(?:Type|Employment Type|Job type)\s*:\s*([A-Za-z, /-]+?)(?=\s+(?:Pay|Location|Shift|Hours|Within|Start Date)\b|$)/i);return m?.[1]?.trim()||'';}
  // Amazon has used generic, hashed CSS class names for Recommended cards.
  // In addition to semantic candidate selectors, discover a card from its own
  // visible distance/location line and then climb to the smallest full card.
  const hasLocationMarker=s=>/\bWithin\s*\d+(?:\.\d+)?\s*(?:mi|miles?)\b|\bMultiple\s+On\s+Site\s+locations\s+available\b/i.test(s);
  function looksLikeJobCard(el){
    if(!visible(el))return false;
    const s=textOf(el);
    if(s.length<25||s.length>1100||!hasLocationMarker(s))return false;
    // Avoid a parent containing two cards, the recommended list or the page.
    if((s.match(/\bWithin\s*\d+(?:\.\d+)?\s*(?:mi|miles?)\b|\bMultiple\s+On\s+Site\s+locations\s+available\b/gi)||[]).length!==1)return false;
    const hasHeading=[...el.querySelectorAll('h2,h3,h4,h5,[role="heading"]')].some(e=>visible(e)&&textOf(e).length>=6&&textOf(e).length<140);
    const hasDetails=/\bType\s*:/i.test(s)&&/\b(?:Duration|Pay rate|Pay|Within)\s*:?/i.test(s);
    return hasHeading||hasDetails;
  }
  function anchorDiscoveredCards(){
    const found=[];
    const addFromLeaf=leaf=>{
      if(!leaf||!leaf.isConnected||!visible(leaf))return;
      let el=leaf;
      for(let depth=0;el&&el!==document.body&&depth<9;depth++,el=el.parentElement){
        if(looksLikeJobCard(el)){
          if(!found.includes(el))found.push(el);
          return;
        }
      }
    };
    // Most Amazon distance labels are direct text nodes. Reading nodeValue is
    // inexpensive: unlike repeatedly reading innerText on every DIV, it does
    // not force layout/style calculations for the entire Recommended page.
    const root=document.body||document.documentElement;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node,walked=0;
    while((node=walker.nextNode())&&walked++<30000&&found.length<90){
      const text=node.nodeValue||'';
      if(text.length>260||!/\b(?:within|multiple\s+on\s+site)\b/i.test(text))continue;
      // A label may be split into child spans; its nearest short container
      // still provides the correct location line in that case.
      let leaf=node.parentElement;
      for(let depth=0;leaf&&depth<3;depth++,leaf=leaf.parentElement){
        const value=leaf.textContent||'';
        if(value.length>300)break;
        if(hasLocationMarker(value)){addFromLeaf(leaf);break;}
      }
    }
    if(found.length)return found;
    // Compatibility fallback for a card whose location line is drawn using
    // non-text markup or several separate nested text nodes.
    const leaves=document.querySelectorAll('span,p,small,strong,div,li');
    for(const leaf of leaves){
      if(found.length>=90)break;
      if(leaf.children.length>3)continue;
      const value=leaf.textContent||'';
      if(value.length>240||!hasLocationMarker(value))continue;
      addFromLeaf(leaf);
    }
    return found;
  }
  function bestClickTarget(el){
    // If a full card is wrapped in a link/button use that interactive wrapper;
    // otherwise click the recognised card element and let its event bubble.
    const wrapper=el.closest('a[href],button,[role="button"],[role="link"]');
    if(wrapper&&enabledTarget(wrapper)&&textOf(wrapper).length<1200)return wrapper;
    const links=[...el.querySelectorAll('a[href]')].filter(enabledTarget);
    const title=el.querySelector('h2,h3,h4,h5,[role="heading"]');
    const titleLink=links.find(a=>title&&(a.contains(title)||title.contains(a)));
    if(titleLink)return titleLink;
    if(links.length===1&&/job|details/i.test(links[0].getAttribute('href')||''))return links[0];
    return el;
  }
  function cardClickCandidates(card){
    const choices=[];
    const add=el=>{if(el&&enabledTarget(el)&&!choices.includes(el))choices.push(el);};
    const primary=bestClickTarget(card);
    add(primary);
    const title=card.querySelector('h2,h3,h4,h5,[role="heading"]');
    // React job cards can bind the handler to a parent card, a child title,
    // or a wrapping link. Try alternate verified nodes only when the first
    // click has demonstrably left the same result card on the search page.
    const elements=[card,...card.querySelectorAll('a[href],button,[role="button"],[role="link"],[tabindex]')];
    for(const e of elements){
      if(e===primary)continue;
      const cursor=getComputedStyle(e).cursor;
      if(e.matches('a[href],button,[role="button"],[role="link"]')||e.hasAttribute('onclick')||cursor==='pointer')add(e);
    }
    add(title);add(card);
    let ancestor=card.parentElement;
    for(let depth=0;ancestor&&ancestor!==document.body&&depth<4;depth++,ancestor=ancestor.parentElement){
      const t=textOf(ancestor);
      if(t.length>1500||(t.match(/\bWithin\s*\d+(?:\.\d+)?\s*(?:mi|miles?)\b|\bMultiple\s+On\s+Site\s+locations\s+available\b/gi)||[]).length!==1)break;
      const cursor=getComputedStyle(ancestor).cursor;
      if(ancestor.matches('a[href],button,[role="button"],[role="link"]')||ancestor.hasAttribute('onclick')||cursor==='pointer')add(ancestor);
    }
    // Keep the retry set short: repeated clicks on the same inert container
    // are not a sensible substitute for detecting an actual transition.
    return choices.slice(0,5);
  }
  function cards(){
    if(!jobCardsDirty)return cachedJobCards;
    const started=performance.now();
    const explicit=findContainers('[data-testid*="job-card" i],[data-test*="job-card" i],[class*="jobCard"],[class*="JobCard"],[class*="job-card"],[class*="job_card"],[role="listitem"],article,a[href*="/job/"]');
    const candidates=[...new Set([...explicit,...anchorDiscoveredCards()])];
    const matched=[];
    for(const el of candidates){
      if(!looksLikeJobCard(el))continue;
      const s=textOf(el),locationText=extractLocation(s);
      if(!locationText&&!parseMiles(s)&&!/Multiple On Site locations available/i.test(s))continue;
      matched.push({el,text:s,locationText,distanceMiles:parseMiles(s),employmentType:parseEmployment(s)});
    }
    // Prefer the smallest complete card, never an enclosing results section.
    const filtered=matched.filter(a=>!matched.some(b=>a!==b&&a.el.contains(b.el)&&b.text.length<=a.text.length));
    const unique=new Set();
    cachedJobCards=filtered.slice(0,80).map((c,i)=>{
      // Stable across pay/mileage updates and reordering. Prefer a real
      // Amazon job identifier when it is exposed by this card's own markup.
      const own=[c.el,...c.el.querySelectorAll('[href],[data-job-id],[data-jobid],[data-testid],[id]')].slice(0,150);
      let jobId='';
      for(const node of own){
        const evidence=[node.getAttribute('href'),node.getAttribute('data-job-id'),
          node.getAttribute('data-jobid'),node.getAttribute('data-testid'),node.id].filter(Boolean).join(' ');
        const hit=evidence.match(/\bJOB-UK-[0-9A-Za-z-]+\b/i)||evidence.match(/[?&]jobId=([A-Za-z0-9_-]+)/i);
        if(hit){jobId=(hit[1]||hit[0]).toLowerCase();break;}
      }
      const title=[...c.el.querySelectorAll('h2,h3,h4,h5,[role="heading"]')]
        .find(e=>visible(e)&&textOf(e).length>=6);
      const duration=c.text.match(/\bDuration\s*:\s*(.*?)(?=\b(?:Pay rate|Pay|Within|Location|Type)\s*:|$)/i)?.[1]||'';
      const norm=v=>String(v||'').replace(/\s+/g,' ').trim().toLowerCase();
      const key=jobId?`job-id:${jobId}`:
        `card:${[norm(textOf(title)),norm(c.locationText),norm(c.employmentType),norm(duration)].join('::')}`;
      if(unique.has(key))return null;unique.add(key);
      const targets=cardClickCandidates(c.el).map(identify);
      return {id:targets[0],targets,key,title:textOf(title)||'',text:c.text,locationText:c.locationText,
        distanceMiles:c.distanceMiles,employmentType:c.employmentType,order:i};
    }).filter(Boolean);
    jobCardsDirty=false;
    lastCardScanMs=Math.round((performance.now()-started)*10)/10;
    return cachedJobCards;
  }
  function parseShift(s){
    const hrs=s.match(/\bHours\s*:\s*(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\s*(?:\/\s*|per\s*)week\b/i);
    const field=s.match(/\bShift\s*:\s*([\s\S]{0,190}?)(?=\b(?:Hours\s*:|Pay\s*:|Start date\s*:|End date\s*:|Location\s*:|Select this job)\b|$)/i);
    if(!hrs||!field)return null;
    const raw=field[1];
    const weekdayMatches=raw.match(/\b(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/gi)||[];
    const abbrevs=new Set(weekdayMatches.map(d=>lower(d).slice(0,3)));
    // A weekday range such as Mon–Fri represents five days, not two.
    const days=['mon','tue','wed','thu','fri','sat','sun'];
    const range=raw.match(/\b(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*(?:-|–|—|to)\s*(Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\b/i);
    if(range){const from=days.indexOf(lower(range[1]).slice(0,3)),to=days.indexOf(lower(range[2]).slice(0,3));
      if(from>=0&&to>=0){for(let n=from;n!==to;n=(n+1)%7)abbrevs.add(days[n]);abbrevs.add(days[to]);}}

    const time=raw.match(/\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\s*(?:-|–|to)\s*\d{1,2}(?::|\.)\d{2}/i);
    let startTime=null;
    if(time){let h=Number(time[1]);const m=Number(time[2]);const ampm=lower(time[3]);if(ampm&&h<=12)h=h%12+(ampm==='pm'?12:0);if(h<=23&&m<=59)startTime=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0');}
    return {weeklyHours:Number(hrs[1]),workingDays:abbrevs.size||null,startTime};
  }
  function shifts(){
    const matched=[];
    const explicit=findContainers('[data-testid*="shift" i],[class*="shiftCard"],[class*="ShiftCard"],[class*="shift-card"],[class*="card" i],[role="radio"],article,li');
    // Real shift cards may consist solely of generic DIVs, with separate
    // Hours and Shift descendants. Climb from Hours text to the smallest
    // complete card without combining adjacent shift cards.
    const anchored=[];
    const leaves=document.querySelectorAll('div,span,p,small,strong');
    for(const leaf of leaves){
      if(anchored.length>=100)break;
      if(!visible(leaf)||leaf.children.length>3)continue;
      const t=textOf(leaf);
      if(t.length>145||!/^Hours\s*:\s*\d+(?:\.\d+)?\s*(?:hours?|hrs?)\s*(?:\/\s*|per\s*)week/i.test(t))continue;
      let parent=leaf;
      for(let depth=0;parent&&parent!==document.body&&depth<9;depth++,parent=parent.parentElement){
        const full=textOf(parent);
        if(full.length>1300)break;
        if((full.match(/\bHours\s*:/gi)||[]).length===1&&
           (full.match(/\bShift\s*:/gi)||[]).length===1&&parseShift(full)){
          anchored.push(parent);break;
        }
      }
    }
    for(const el of new Set([...explicit,...anchored])){
      const t=textOf(el);if(!visible(el)||t.length<20||t.length>1300)continue;
      if((t.match(/\bHours\s*:/gi)||[]).length!==1||(t.match(/\bShift\s*:/gi)||[]).length!==1)continue;
      const data=parseShift(t);if(data)matched.push({el,text:t,...data});
    }
    const filtered=matched.filter(a=>!matched.some(b=>a!==b&&a.el.contains(b.el)&&b.text.length<=a.text.length));
    const seen=new Set();return filtered.slice(0,60).map((c,i)=>{
      const key=[c.text,c.weeklyHours,c.workingDays,c.startTime].join('::');if(seen.has(key))return null;seen.add(key);
      const target=c.el.querySelector('[role="radio"],button,[role="button"]')||c.el;
      const end=c.text.match(/\b(?:-|–|to)\s*(\d{1,2}[:.]\d{2})\b/i)?.[1]||null;
      return {id:identify(target),key,text:c.text,weeklyHours:c.weeklyHours,workingDays:c.workingDays,startTime:c.startTime,endTime:end,order:i};
    }).filter(Boolean);
  }
  function headingVisible(regex){
    return [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"],[aria-current="step"],strong')]
      .some(e=>visible(e)&&regex.test(textOf(e)));
  }
  function visibleProgressText(regex){
    // Amazon's progress line can be a DIV or SPAN, not a heading. Check only
    // short visible elements, never all body text or hidden template markup.
    for(const el of document.querySelectorAll('h1,h2,h3,h4,div,span,p,small,strong,[aria-label],[data-testid]')){
      if(!visible(el))continue;
      const content=textOf(el);
      if(content.length<=120&&regex.test(content))return true;
      const label=(el.getAttribute('aria-label')||'');
      if(label.length<=120&&regex.test(label))return true;
    }
    return false;
  }
  function publicJobSearch(){
    // A signed-out session can land on Amazon's generic public search page
    // without a password field or login URL. This is NOT proof of logout in
    // isolation: require the specific public-search layout and the absence of
    // any Recommended tab/results. Never treat an ordinary All tab (while
    // Recommended is still present) as a login failure.
    if(!/\/jobSearch/i.test(location.pathname+location.hash))return false;
    const displayedControls=controls();
    if(displayedControls.some(e=>/^recommended$/i.test(getLabel(e))))return false;
    if(visibleProgressText(/^Recommended jobs for you$/i))return false;
    if(!visibleProgressText(/^(?:[\d,]+\s+jobs?\s+found|no\s+jobs?\s+found)$/i))return false;
    const searchInput=[...document.querySelectorAll('input')].some(e=>visible(e)&&
      /\bsearch\s+jobs?\b/i.test([e.placeholder,e.getAttribute('aria-label')].filter(Boolean).join(' ')));
    const publicControls=displayedControls.some(e=>/^(?:add filter|sort by)$/i.test(getLabel(e)));
    return searchInput&&publicControls;
  }
  function loginRequired(){
    // Do not confuse Amazon's sign-in page with a normal application step.
    // Require a visible password field or explicit login route plus sign-in UI.
    const password=[...document.querySelectorAll('input[type="password"]')].some(visible);
    const heading=visibleProgressText(/^(?:sign\s*in|log\s*in|login|sign\s*in\s*to\s*continue)$/i);
    const loginUrl=/\/(?:sign-?in|log-?in|login|auth(?:entication)?)(?:\/|[?#]|$)/i.test(location.pathname+location.hash);
    const form=[...document.querySelectorAll('form')].some(visible);
    return (password&&(heading||form||loginUrl))||(loginUrl&&heading);
  }
  function securityBlock(){
    // Identify an ACTIVE, visible blocking screen, not a hidden CAPTCHA
    // template, a background script or incidental security-related text.
    // Amazon's "Let's confirm you are human" screen presents only a
    // heading, security-check instructions and a Begin button: no form or
    // iframe is required for it to block the application.
    const humanTitle=visibleProgressText(/\b(?:let[’']?s\s+confirm\s+you\s+are\s+human|confirm\s+you(?:'re|\s+are)\s+human|verify\s+(?:that\s+)?you(?:'re|\s+are)\s+(?:a\s+)?human|are\s+you\s+(?:a\s+)?(?:human|robot)|human\s+verification\s+(?:required|needed))\b/i);
    const securityInstructions=[...document.querySelectorAll('p,div,span,label,section,article')].some(el=>visible(el)&&textOf(el).length<=320&&/\b(?:complete\s+(?:the|a)\s+security\s+check\s+before\s+continuing|this\s+step\s+verifies?\s+that\s+you\s+are\s+not\s+a\s+bot|please\s+(?:complete|pass)\s+(?:the|a)\s+(?:security\s+)?(?:check|captcha|verification)\s+to\s+continue|to\s+continue.{0,35}verify\s+you(?:'re|\s+are)\s+human)\b/i.test(textOf(el)));
    const primaryAction=controls().some(el=>/^(?:begin(?:\s*[❯>›→])?|verify|verify now|start verification|continue to verification|i(?:'m| am) not a robot)$/i.test(getLabel(el)));
    // A full-page challenge with a matching title and instructions is already
    // enough evidence. Requiring a CAPTCHA form here caused false negatives.
    if(humanTitle&&(securityInstructions||primaryAction))return true;
    const challenge=[...document.querySelectorAll('iframe[title],input[name],input[id]')].some(e=>{
      if(!visible(e))return false;
      const lab=[e.getAttribute('title'),e.name,e.id].filter(Boolean).join(' ');
      return /(captcha|recaptcha|hcaptcha|arkose|security.challenge)/i.test(lab);
    });
    const blocker=headingVisible(/^(?:verify (?:you|your|your identity)|security check|security verification|security check required|verification required|complete (?:the )?captcha|sign in to continue|human verification)$/i);
    const password=[...document.querySelectorAll('input[type="password"]')].some(visible);
    const visibleForm=[...document.querySelectorAll('form')].some(visible);
    const formOrChallenge=challenge||password||visibleForm;
    const puzzle=visibleProgressText(/\b(?:select\s+all\s+images|select\s+every\s+image|solve\s+the\s+(?:puzzle|captcha)|drag\s+the\s+slider|press\s+and\s+hold\s+to\s+verify|rotate\s+the\s+image|complete\s+the\s+captcha)\b/i);
    const largeCaptcha=[...document.querySelectorAll('iframe[title]')].some(el=>{
      if(!visible(el))return false;
      const title=el.getAttribute('title')||'';
      const rect=el.getBoundingClientRect();
      return /(?:captcha|arkose|security challenge|verification challenge)/i.test(title)&&rect.width>=80&&rect.height>=45;
    });
    return Boolean((blocker&&(formOrChallenge||securityInstructions||primaryAction))||
      (challenge&&(visibleForm||securityInstructions||primaryAction))||largeCaptcha||
      (puzzle&&(primaryAction||challenge||[...document.querySelectorAll('input,button,[role=button]')].some(enabledTarget)))||
      (password&&(headingVisible(/^(?:sign in|log in|login)$/i)||visibleProgressText(/\bsign\s*in\s+to\s+continue\b/i))));
  }
  function snapshot(){
    const btns=controls(),buttons=buttonMap(btns),url=location.href;
    const isSearch=/\.jobsatamazon\.co\.uk$|^jobsatamazon\.co\.uk$/.test(location.hostname)&&(/\/jobSearch/i.test(location.hash+location.pathname)||(/\bjob search\b/i.test(document.title)&&buttons.recommended));
    // textContent avoids forcing full-page layout on every search-page
    // mutation. Visibility-sensitive protection is checked separately below.
    const body=(document.body?.textContent||'').replace(/\s+/g,' ').slice(0,25000);
    const noShifts=/The job you selected doesn[’']t have available shifts\. Please choose another job below\./i.test(body)&&
      visibleProgressText(/The job you selected doesn[’']t have available shifts\. Please choose another job below\./i);
    // Confirm a current, VISIBLE Amazon no-available-shift screen (not text
    // in hidden templates). The page may bypass Step 2 entirely.
    const noShiftTitle=!isSearch&&visibleProgressText(/^(?:more shifts? are on the way!?|no (?:available )?shifts? (?:are )?available!?|no shifts? found!?)$/i);
    const noShiftPage=noShiftTitle&&(
      /no-available-shift/i.test(location.href)||
      visibleProgressText(/(?:we post jobs often|submit your shift preferences|we will contact you when we find a shift)/i));
    const step2=!isSearch&&visibleProgressText(/\bStep\s*2\s*(?:of|\/)\s*6\b/i);
    const prehire=!isSearch&&visibleProgressText(/Schedule\s+pre[- ]hire\s+appointment/i)&&/\b(appointment|select\s+date|available\s+times?|schedule)\b/i.test(body);
    const jobCards=isSearch?cards():[];
    const recommendedResults=isSearch&&jobCards.length>0&&/\bRecommended jobs for you\b/i.test(body);
    const active=activeRecommended(btns,recommendedResults);
    const shiftCards=step2?shifts():[];
    const loading=Array.from(document.querySelectorAll('[aria-busy="true"],[class*="skeleton" i],[class*="spinner" i],[data-loading="true"]')).some(visible);
    const shiftListReady=shiftCards.length>0||noShiftPage||visibleProgressText(/\b(?:no shifts? available|no available shifts?|there are no shifts?)\b/i);
    // Cache the verified click target IDs from this observation; a subsequent
    // CLICK still checks visibility and security. Avoid a SECOND full page
    // snapshot in the critical detection-to-click path.
    allowedClickIds=new Set([...Object.values(buttons),...jobCards.flatMap(c=>c.targets||[c.id]),...shiftCards.map(c=>c.id)]);
    const login=loginRequired();
    const security=login?false:securityBlock();
    const publicSearch=isSearch&&!loading&&!login&&publicJobSearch();
    return {cardScanMs:isSearch?lastCardScanMs:0,url,hostname:location.hostname,isSearch,activeRecommended:active,recommendedResults,buttons,jobCards,shiftCards,noShifts,noShiftPage,step2,shiftListReady,prehire,
      securityBlocked:security,loginRequired:login,publicJobSearch:publicSearch,loading,title:document.title,
      appEvidence:noShiftPage||step2||prehire||!!buttons.start||!!buttons.agree||!!buttons.acceptOffer||/\b(?:hiring|application|candidate)\b/i.test(location.hostname+location.pathname),
      timestamp:Date.now()};
  }
  function contextAlive(){try{return !!chrome.runtime?.id;}catch{return false;}}
  function invalidated(error){
    if(!contextAlive()||/Extension context invalidated/i.test(String(error))){
      enabled=false;clearTimeout(timer);clearTimeout(clockTimer);
      if(window.__amazonFullApplyObserver)window.__amazonFullApplyObserver.disconnect();
      if(window.__amazonFullApplyPulse)clearInterval(window.__amazonFullApplyPulse);
    }
  }
  function emit(force=false){
    if(!enabled)return;
    const snap=snapshot();
    // Timing data is diagnostic, not a page change; do not re-emit merely
    // because this scan took a different number of milliseconds.
    const sig=JSON.stringify({...snap,timestamp:0,cardScanMs:0});
    if(!force&&sig===lastSignature)return;lastSignature=sig;
    if(!contextAlive())return;
    chrome.runtime.sendMessage({type:'OBSERVATION',snapshot:snap}).catch(invalidated);
  }
  function requestScan(force=false){
    if(!enabled)return;
    if(force){clearTimeout(timer);timer=null;emit(true);return;}
    if(timer!==null)return;
    // Zero-delay task batches synchronous React DOM mutations without the
    // previous fixed 45ms delay. The safety/recovery grace is unchanged.
    timer=setTimeout(()=>{timer=null;emit();},0);
  }
  function setClock(when){clearTimeout(clockTimer);if(!enabled||!when)return;
    const ms=Math.max(0,when-Date.now());clockTimer=setTimeout(()=>{if(contextAlive())chrome.runtime.sendMessage({type:'CLOCK_DUE',dueAt:when}).catch(invalidated);},ms);
  }
  window.__amazonFullApplyObserver=new MutationObserver(records=>{
    // Any structural/text/visibility change can alter card eligibility,
    // including newly added 'Part Time' text on a previously attempted job.
    // Invalidate only the card cache; the scan itself runs once per task.
    jobCardsDirty=true;
    requestScan();
  });
  window.__amazonFullApplyObserver.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-selected','style','disabled','aria-hidden'],characterData:true});
  window.addEventListener('hashchange',()=>requestScan(true));window.addEventListener('popstate',()=>requestScan(true));
  // A one-second liveness pulse is also an MV3 service-worker wake-up source.
  // MutationObserver remains the primary, lower-latency stage detector.
  window.__amazonFullApplyPulse=setInterval(()=>{if(!contextAlive()){invalidated('Extension context invalidated');return;}
    if(enabled){chrome.runtime.sendMessage({type:'WATCH_TICK',generation}).catch(invalidated);}},1000);
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{
    if(msg?.type==='ENABLE'){
      enabled=true;generation=msg.generation||0;lastSignature='';jobCardsDirty=true;allowedClickIds.clear();setClock(msg.clockAt);reply({ok:true});requestScan(true);return;
    }
    if(msg?.type==='DISABLE'){enabled=false;clearTimeout(clockTimer);clearTimeout(timer);reply({ok:true});return;}
    if(msg?.type==='ARM_CLOCK'){setClock(msg.when);reply({ok:true});return;}
    if(msg?.type==='SCAN'){if(enabled)requestScan(true);reply({ok:enabled});return;}
    if(msg?.type==='SECURITY_STATUS'){
      // Read-only preflight for a manual Start after security interruption.
      // Available even while automatic clicking is disabled.
      reply({ok:true,blocked:securityBlock()&&!loginRequired(),loginRequired:loginRequired(),publicJobSearch:publicJobSearch()});return;
    }
    if(msg?.type==='CLICK'){
      if(!enabled||msg.generation!==generation){reply({ok:false,reason:'Inactive/stale session'});return;}
      if(securityBlock()||loginRequired()||publicJobSearch()){
        // Fail closed if the challenge appeared between SCAN and CLICK.
        requestScan(true);reply({ok:false,reason:'Security, sign-in or public job-search screen blocks automation'});return;
      }
      const el=roots.get(msg.id);
      if(!enabledTarget(el)){reply({ok:false,reason:'Target vanished or disabled'});return;}
      // Recheck a changed page, but reuse the last verified target set if no
      // mutation occurred. Security/login checks above are always fresh.
      if(jobCardsDirty)snapshot();
      if(!allowedClickIds.has(msg.id)){
        reply({ok:false,reason:'Target no longer belongs to active screen'});return;
      }
      const key=msg.id+'::'+msg.label;if(key===lastClick&&Date.now()-lastClickAt<1500){reply({ok:false,reason:'Duplicate click suppressed'});return;}
      lastClick=key;lastClickAt=Date.now();
      try{el.click();reply({ok:true});setTimeout(()=>requestScan(true),110);}catch(e){reply({ok:false,reason:String(e)});}
      return;
    }
    if(msg?.type==='HISTORY_BACK'){
      if(!enabled||securityBlock()||loginRequired()||publicJobSearch()){
        if(enabled)requestScan(true);
        reply({ok:false,reason:'Automation inactive or security verification required'});return;
      }history.back();reply({ok:true});setTimeout(()=>requestScan(true),450);return;
    }
  });
})();
