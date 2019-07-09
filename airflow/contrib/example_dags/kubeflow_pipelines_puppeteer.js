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
  userDataDir: process.env("USER_DATA_DIR"),
});
const page = await browser.newPage();

let width = 1300, height = 470;

async function screenshot(name) {
  await page.screenshot({path: dir + '/' + name + '.png'});
  console.log("screenshotted:", name);
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

  await page.waitFor(1000);
}

let statusIdxs = {};
[ 'success', 'running', 'failed', 'upstream_failed', 'skipped', 'up_for_retry', 'up_for_reschedule', 'queued', '', 'scheduled' ].forEach(
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

async function wait(s) {
  console.log("sleep " + s + "s");
  return page.waitFor(s * 1000)
}

const log = console.log;

async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle2' });
}

async function runCoin() {

  await goto(homepage);
  await resize();
  await screenshot('homepage');

  const trigger = '#dags tr:nth-child(2) > td:last-child > a:first-child > span';

  await page.hover(trigger);
  log('hovered');
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

  height = 530;
  await resize(width, height);
  await wait(1);

  await page.hover('#dags tr:nth-child(2) > td:nth-child(8) > svg > g:nth-child(2) > circle');
  log("hover circle");
  await wait(.5);

  await screenshot('running');

  while (true) {
    await wait(4000);
    log("slept 4s");
    await page.reload();
    await wait(1);
    log("reloaded");
    const [ successes, pendings ] = await page.evaluate(async() => {
      const $ = window.$;
      const successes = await statusCount(2, 'success'); // $('#dags tr:nth-child(2) > td:nth-child(6) > svg > g:first-child:has(> text:not(:empty)) > circle');
      const pendings = [
        'running',
        'queued',
        'scheduled',
      ]
      .map(async s => await statusCount(2, s));
      return [ successes, pendings ];
    });
    log(successes, "successes, pendings:", pendings);
    if (successes > 0 && pendings.reduce((a, b) => a+b, 0) === 0) {
      break;
    } else {
      log("Couldn't find success badge; reload");
    }
  }

  let selector = '#dags tr:nth-child(2) > td:nth-child(6) > svg > g:first-child > circle';
  await page.hover(selector);
  await wait(.5);
  await screenshot('succeeded');

  await page.click(selector);
  log("clicked circle");
  await wait(1);
}

async function clickLogs() {
  await page.click('.table-responsive > table > tbody > tr:first-child > td:last-child > a');
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

//runCoin();
//runDetails();

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

async function sequentialKFPJob() {
  //await recents('kubeflow_pipelines_sequential_example');

  await clickLogs();
  await wait(2);
  await gotoJob();
  width = 1200; height = 700; await resize();
  const graphNode = '.graphNode > div:first-child';
  await page.waitForSelector(graphNode, 10000);
  const [ clicked, texts ] = await page.evaluate(async (graphNode) => {
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
  }, graphNode);

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

await sequentialDetails();
// await sequentialKFPJob();

await browser.close();
})();
