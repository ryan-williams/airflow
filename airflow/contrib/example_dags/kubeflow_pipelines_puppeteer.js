const puppeteer = require('puppeteer');
const moment = require('moment');

const now = moment().unix();
const dir = 'out-' + now;
const fs = require('fs');
fs.mkdirSync(dir);
console.log("writing screenshots to:", dir);

(async() => {
const browser = await puppeteer.launch({
  headless: false,
  args: [
    '--no-sandbox',
  ],
  userDataDir: process.env["USER_DATA_DIR"],
});
const page = await browser.newPage();

let width = 1500, height = 600;

async function wait(s) {
  console.log("sleep " + s + "s");
  return page.waitFor(s * 1000)
}

const log = console.log;

idx = 0;
async function screenshot(name) {
  idx += 1;
  await page.screenshot({path: dir + '/' + (('0' + idx).slice(-2)) + '-' + name + '.png'});
  log("screenshotted:", name);
  await wait(1);
}

async function resize() {
  await page.setViewport({height, width});

  // Window frame - probably OS and WM dependent.
  height += 85;

  // Any tab.
  const {targetInfos: [{targetId}]} = await browser._connection.send(
    'Target.getTargets'
  );

  // Tab window.
  const {windowId} = await browser._connection.send(
    'Browser.getWindowForTarget',
    {targetId}
  );

  // Resize.
  await browser._connection.send('Browser.setWindowBounds', {
    bounds: {height, width},
    windowId
  });

  await wait(1);
}

let statusIdxs = {};
[ 'success', 'running', 'failed', 'upstream_failed', 'skipped', 'up_for_retry', 'up_for_reschedule', 'queued', 'null', 'scheduled' ].forEach(
  (label, idx) => statusIdxs[label] = idx + 1
);
console.log(statusIdxs);
async function statusCount(row, label) {
  const idx = statusIdxs[label];
  if (idx === undefined) {
    throw Error('Label ' + label + ' not found');
  }
  return page.evaluate(
    ([row, idx]) => {
      const text = $('#dags tr:nth-child(' + row + ') > td:nth-child(6) > svg > g:nth-child(' + idx + ') > text').text();
      if (text === '') return 0;
      return parseInt(text);
    },
    [row, idx]
  );
}

const AIRFLOW_HOST = process.env.AIRFLOW_HOST;
if (!AIRFLOW_HOST) {
  throw Error("Specify AIRFLOW_HOST env var with the base URL of an Airflow Web UI instance");
}
const homepage = AIRFLOW_HOST + '/admin/';

async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle2' });
}

async function findDagRowIdx(name) {
  return await page.evaluate(
    (name) => {
      return $('#dags tr > td:nth-child(3):contains(' + name + ')').parent().index();
    },
    name
  );
}

async function pos(selector) {
  return await page.evaluate((selector) => {
    var elem = $(selector);
    let w = elem.outerWidth(), h = elem.outerHeight();
    if (w === 0 && h === 0) {
      const rect = elem[0].getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      console.log("read svg w/h:", w, h);
    }
    return [ elem.offset(), { w, h } ];
  }, selector);
}

async function arrow(selector, degrees, adjustPad) {
  const [ offset, size ] = await pos(selector);
  console.log("offset:", offset, "size:", size);
  const { top, left } = offset;
  const { w, h } = size;
  const center = {
    top: top + h / 2,
    left: left + w / 2
  };
  const pad = Math.sqrt((w*w + h*h) / 2);
  adjustPad = adjustPad || { x: 0, y: 0 }
  return drawArrow(center, degrees, { x: pad + adjustPad.x, y: pad + adjustPad.y });
}

const ARROW_URL = "https://cl.ly/c1865a257057/600px-Red_arrow_southeast.svg.png";
async function drawArrow(pos, degrees, pad) {
  degrees = degrees || 0;
  console.log("drawing arrow: ", pos, degrees, pad);
  degrees = 135 - degrees;
  pad = pad || { x: 0, y: 0 };
  const w = 100, h = 100;
  await page.evaluate(([pos, w, h, degrees, pad, ARROW_URL]) => {
    var img = document.createElement('img');
    img.src = ARROW_URL;
    img.width = "100";
    img.height = "100";
    const { top, left, right, bottom, ...rest } = pos;
    const box = { top, left, right, bottom };
    Object.assign(
      img.style,
      {
        position: "absolute",
        "z-index": 1000,
        "transform": "translate(" + (-w/2) + "px," + (-h/2) + "px) rotate(" + degrees + "deg) translate(" + (-w/2 - pad.x) + "px," + (-h/2 - pad.y) + "px)",
      },
      rest,
      Object.keys(box).reduce((o, k) => { o[k] = box[k] + 'px'; return o; }, {} )
    );
    document.body.appendChild(img);

    if (!window.arrows) {
      window.arrows = [];
    }
    window.arrows.push(img);

    return img;
  }, [pos, w, h, degrees, pad, ARROW_URL]);
  // arrows.push(arrow);
  // return arrow;
}

async function clearArrows() {
  await page.evaluate(() => {
    console.log("trying to remove arrows:", window.arrows);
    window.arrows.forEach((a) => window.document.body.removeChild(a));
    window.arrows = [];
  });
}

async function home() {
  await goto(homepage);
  await resize();
  await screenshot('homepage');
}

async function runCoin() {
  const dagRowIdx = await findDagRowIdx('kubeflow_pipelines_coin_example') + 1;
  const row = '#dags tr:nth-child(' + dagRowIdx + ')';

  await hoverClickTrigger(row);
  await hoverRunning(row);
  await waitForSuccessCircle(dagRowIdx);
  return row;
}

async function hoverClickTrigger(row) {
  const trigger = row + ' > td:last-child > a:first-child > span';

  await page.hover(trigger);
  log('hovered over trigger DAG button');
  await wait(.5);
  await arrow(trigger, -150);
  await wait(.5);
  await screenshot('trigger');

  await page.click(trigger);
  await wait(1);

  // log("clicked");
  // page.on('dialog', async dialog => {
  //   log("dialog:", dialog.message());
  //   await dialog.accept();
  // });
  // await page.keyboard.press('Enter');

  //height += 60;
  await resize(width, height);
  await wait(1);
}

async function hoverRunning(row) {
  const selector = row + ' > td:nth-child(8) > svg > g:nth-child(2) > circle';
  await page.hover(selector);
  log("hover circle");
  await wait(.5);
  await arrow(selector, 90);
  const [ { top, left }, { w, h } ] = await pos('.alert.alert-info');
  await drawArrow( { top: top + h, left: 200 }, -90);
  await wait(.5);
  await screenshot('running');
}

async function waitForSuccessCircle(row) {
  while (true) {
    await wait(4);
    log("slept 4s");
    await page.reload();
    await wait(1);
    log("reloaded; checking dag row idx ", row);
    const successes = await statusCount(row, 'success');
    const pendings = await Promise.all(
      [
        'running',
        'queued',
        'null',
        'scheduled',
      ]
      .map(async s => await statusCount(row, s))
    );

    log(successes, "successes, pendings:", pendings);
    if (successes > 0 && pendings.reduce((a, b) => a+b, 0) === 0) {
      break;
    } else {
      log("Couldn't find success badge; reload");
    }
  }

}

async function clickSuccessCircle(row) {
  const selector = row + ' > td:nth-child(6) > svg > g:first-child > circle';
  await page.hover(selector);
  await wait(.5);
  await arrow(selector, -45, { x: -10, y: -10 });
  await wait(.5);
  await screenshot('succeeded');

  await page.click(selector);
  log("clicked circle");
  await wait(1);
}

async function clickLogs(name) {
  if (name) {
    await goto(AIRFLOW_HOST + '/admin/taskinstance/?flt0_dag_id_equals=' + name);
  }
  const selector = '.table-responsive > table > tbody > tr:first-child > td:last-child > a';
  await page.hover(selector);
  await wait(.5);
  await arrow(selector, 150);
  await wait(.5);
  await screenshot("logs-link");
  await page.click(selector);
}

async function logsPage() {
  await drawArrow({ bottom: -10, left: 1070, position: "fixed" },  90);
  await drawArrow({ bottom: 190, left: 1200, position: "fixed" }, 270);
  await wait(1);
  await page.evaluate(async () => {
    console.log("scroll to:", document.body.scrollHeight);
    window.scrollTo(0, document.body.scrollHeight);
  });
  await wait(1);
  await screenshot("logs-page");
}

async function jobUrl() {
  let match = await page.evaluate(() => {
    return window.$('pre > code').text().match(/INFO - Job running: (.*)/)
  });
  if (match) {
    return match[1];
  }
  await page.reload();
  await wait(3);
  return await jobUrl();
}

async function gotoJob() {
  const job_url = await jobUrl();
  log("Got job URL:", job_url);
  await goto(job_url);
  await screenshot('kfp-job-ui');
}

async function recents(dag, state) {
  let url = AIRFLOW_HOST + '/admin/taskinstance/?flt1_dag_id_equals=' + dag;
  if (state) {
    url += '&flt2_state_equals=' + state
  }
  console.log("Recents url:", url);
  await goto(url);
  await wait(1);
}

async function runDetails() {
  await recents('kubeflow_pipelines_coin_example', 'success');
  width = 2350; height = 500; resize();
  await screenshot('successes');

  await clickLogs();
  height = 1100; await resize();
  await screenshot('logs');

  await gotoJob();
  width = 900; height = 600; await resize();
  await screenshot('kfp');
}

async function kfpMenu() {
  await clearArrows();
  const dropdown = '#admin-navbar-collapse > .navbar-nav > li:nth-child(3)';
  await page.click(dropdown + ' > a');
  log("clicked 'Browse' menu");
  await wait(1);

  const kfp = dropdown + ' > ul > li:last-child > a';
  await arrow(kfp, -30, { x: -50, y: -70 });
  await page.hover(kfp);
  await screenshot('kfp-menu');

  await page.click(kfp);
  await wait(1);
}

async function kfpPage(load) {
  if (load) {
    await goto(AIRFLOW_HOST + '/admin/kfp/');
  }
  const link = 'tr:first-child > td.col-value > a';
  await arrow(link, 150);
  await wait(.5);
  await screenshot('kfp-page');
  await page.click(link);
  await wait(1);
}

async function sequentialDetails() {
  await goto(homepage);
  await resize();

  for (let i = 0; i < 5; i++) {
    console.log("looking for running node");
    if ((await statusCount(3, 'running')) > 0) {
      break;
    }
    await page.reload();
    await wait(3);
  }
  const selector = '#dags tr:nth-child(3) > td:nth-child(6) > svg > g:nth-child(2) > circle';
  if (await statusCount(3, 'running') > 0) {
    await page.hover(selector);
    log("hover running circle");
    await wait(.5);
    await screenshot('running');
  }

  if (await statusCount(3, 'running') > 0) {
    await page.click(selector);
    log("clicked circle");
    await wait(1);
  } else {
    await recents('kubeflow_pipelines_sequential_example');
  }

  await sequentialKFPJob();
}

async function kfpSequentialJobPage() {
  width = 1200; height = 700; await resize();
  const graphNode = '.graphNode > div:first-child';
  await page.waitForSelector(graphNode, 10000);
  const [ clicked, texts ] =
    await page.evaluate(
      async (graphNode) => {
        const divs = document.querySelectorAll(graphNode);
        let texts = [];
        let clicked = false;
        for (var i = 0; i < divs.length; i++) {
          const div = divs[i];
          const text = div.innerText;
          texts.push(text);
          if (text == 'echo') {
            div.click();
            clicked = true;
          }
        }
        return [ clicked, texts ]
      },
      graphNode
    );

  console.log("Clicked graph node:", clicked, texts);
  await wait(2);
  await page.evaluate(() => {
    const spans = document.querySelectorAll('button > span > span');
    const logs = spans[spans.length - 1];
    logs.click();
  });
  await wait(1);
  await screenshot('kfp');
}

async function sequentialKFPJob() {
  //await recents('kubeflow_pipelines_sequential_example');

  await clickLogs();
  await wait(2);
  await gotoJob();
  await kfpSequentialJobPage();
}


// const dagRowIdx = await findDagRowIdx('kubeflow_pipelines_coin_example') + 1;
// const row = '#dags tr:nth-child(' + dagRowIdx + ')';
// await hoverClickTrigger(row);

// await arrow('table');
// await clearArrows();

await home();
let row = await runCoin();
await clickSuccessCircle(row);
//await clickLogs('kubeflow_pipelines_coin_example');
await clickLogs();
await logsPage();

//runDetails();

await kfpMenu();
await kfpPage();
width = 850; height = 600;
await resize();
await screenshot('kfp-coin');
//await kfpJobPage();

// await sequentialDetails();
// await sequentialKFPJob();

await browser.close();
})();
