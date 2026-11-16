
import { chromium } from 'playwright';
import path from 'node:path';

const HOME = 'https://www.jobsatamazon.co.uk';

const INTERVAL_MS = 10000;
const NAV_TIMEOUT_MS = 45000;

const PROFILE_PATH = path.resolve(
  process.env.AMAZON_PROFILE_PATH ||
  '/var/www/amazon-bot-system/amazon-receiver/.browser-profile'
);

const AUTO_SUBMIT =
  process.env.AUTO_SUBMIT === 'true';

const log = (event, data = {}) => {
  console.log(JSON.stringify({
    time: new Date().toISOString(),
    component: 'auto-apply',
    event,
    ...data
  }));
};

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function officialJobUrl(value) {
  if (!value) {
    throw new Error('Job has no application URL');
  }

  const url = new URL(value);

  const allowed = [
    'jobsatamazon.co.uk',
    'www.jobsatamazon.co.uk'
  ];

  if (
    url.protocol !== 'https:' ||
    !allowed.includes(url.hostname)
  ) {
    throw new Error('Untrusted application URL');
  }

  return url.href;
}

function pendingEntries(store) {
  if (Array.isArray(store.pending)) {
    return store.pending.map((job, index) => ({
      key: index,
      job
    }));
  }

  return Object.entries(
    store.pending || {}
  ).map(([key, job]) => ({
    key,
    job
  }));
}

function getJobUrl(job) {
  return job.applyUrl ||
    job.jobUrl ||
    job.url ||
    null;
}

async function detectBlock(page, response) {
  if ([403, 429].includes(response?.status())) {
    return true;
  }

  const body = await page.locator('body')
    .innerText({ timeout: 5000 })
    .catch(() => '');

  return /request blocked|access denied|403 error|captcha/i
    .test(body.slice(0, 10000));
}

async function hasConfirmation(page) {
  // Explicit submitted-state confirmation only.
  // Do not interpret a generic thank-you banner
  // or an application form as proof of submission.
  const confirmation = page.getByText(
    /your application (has been submitted|was submitted|is submitted)|application submitted successfully/i
  );

  return await confirmation.first()
    .isVisible()
    .catch(() => false);
}

async function clickUnique(locator) {
  if (await locator.count() !== 1) {
    return false;
  }

  if (!await locator.isVisible()) {
    return false;
  }

  if (!await locator.isEnabled()) {
    return false;
  }

  await locator.click({ timeout: 10000 });
  return true;
}

async function runApplication(page, job) {
  const url = officialJobUrl(getJobUrl(job));

  log('opening_job', {
    jobId: job.jobId,
    url
  });

  const response = await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT_MS
  });

  if (await detectBlock(page, response)) {
    return {
      status: 'blocked',
      reason: 'Amazon refused website access'
    };
  }

  const landed = new URL(page.url());

  if (![
    'jobsatamazon.co.uk',
    'www.jobsatamazon.co.uk'
  ].includes(landed.hostname)) {
    return {
      status: 'review_required',
      reason: 'Navigation left the expected website'
    };
  }

  if (await hasConfirmation(page)) {
    return {
      status: 'review_required',
      reason: 'Existing confirmation found; verify previous application'
    };
  }

  // Find one unambiguous Apply control.
  const apply = page.getByRole('button', {
    name: /^(apply|apply now|apply for this job)$/i
  });

  const applyLink = page.getByRole('link', {
    name: /^(apply|apply now|apply for this job)$/i
  });

  const buttonCount = await apply.count();
  const linkCount = await applyLink.count();

  if (buttonCount + linkCount !== 1) {
    return {
      status: 'review_required',
      reason: 'Apply control missing or ambiguous'
    };
  }

  if (buttonCount === 1) {
    await clickUnique(apply);
  } else {
    await clickUnique(applyLink);
  }

  await sleep(1500);

  if (await detectBlock(page, null)) {
    return {
      status: 'blocked',
      reason: 'Access restriction after Apply'
    };
  }

  // Some vacancies have multiple application steps,
  // eligibility questions, consent and disclosures.
  // Do not guess answers or accept agreements.
  //
  // Automatic submission is possible only when
  // the workflow reaches a clearly identified
  // final submission control without unanswered
  // questions or additional agreements.

  const requiredFields = page.locator(
    'input:required:not([type=hidden]),' +
    'select:required,textarea:required'
  );

  const count = await requiredFields.count();

  for (let i = 0; i < count; i++) {
    const field = requiredFields.nth(i);

    if (!await field.isVisible()) continue;

    const valid = await field.evaluate(el =>
      el.checkValidity()
    ).catch(() => false);

    if (!valid) {
      return {
        status: 'review_required',
        reason: 'Unanswered required application field'
      };
    }
  }

  if (!AUTO_SUBMIT) {
    return {
      status: 'review_required',
      reason: 'Reached application flow; auto-submit disabled'
    };
  }

  const submit = page.getByRole('button', {
    name: /^(submit application|submit my application)$/i
  });

  if (!await clickUnique(submit)) {
    return {
      status: 'review_required',
      reason: 'Final Submit control missing or ambiguous'
    };
  }

  await sleep(2000);

  if (await hasConfirmation(page)) {
    return {
      status: 'applied',
      appliedAt: new Date().toISOString()
    };
  }

  return {
    status: 'review_required',
    reason: 'Submit clicked but completion was not confirmed'
  };
}

export function startAutoApplyWorker({
  store,
  saveStore
}) {
  if (!store || typeof saveStore !== 'function') {
    throw new Error(
      'Provide the Receiver store and its saveStore function'
    );
  }

  let context = null;
  let busy = false;
  let stopped = false;
  let timer = null;

  async function getContext() {
    if (context) return context;

    context = await chromium.launchPersistentContext(
      PROFILE_PATH,
      {
        headless: true,
        viewport: {
          width: 1366,
          height: 768
        },
        chromiumSandbox:
          process.env.CHROMIUM_NO_SANDBOX !== 'true'
      }
    );

    return context;
  }

  async function tick() {
    if (busy || stopped) return;

    busy = true;

    try {
      const entry = pendingEntries(store).find(
        ({ job }) =>
          job &&
          (job.status === 'new' ||
           job.status == null)
      );

      if (!entry) return;

      const { job } = entry;

      job.status = 'applying';
      job.startedAt = new Date().toISOString();

      await saveStore();

      log('processing_job', {
        jobId: job.jobId
      });

      try {
        const browser = await getContext();
        const page = await browser.newPage();

        let result;

        try {
          result = await runApplication(page, job);
        } finally {
          await page.close().catch(() => {});
        }

        job.status = result.status;
        job.updatedAt = new Date().toISOString();

        if (result.reason) {
          job.applyError = result.reason;
        } else {
          delete job.applyError;
        }

        if (result.appliedAt) {
          job.appliedAt = result.appliedAt;
        }

        await saveStore();

        log('job_processed', {
          jobId: job.jobId,
          status: job.status
        });

      } catch (error) {
        job.status = 'review_required';
        job.applyError = error.message;
        job.updatedAt = new Date().toISOString();

        await saveStore();

        log('application_error', {
          jobId: job.jobId,
          error: error.message
        });

        if (
          context &&
          /Target closed|browser has been closed/i.test(
            error.message
          )
        ) {
          await context.close().catch(() => {});
          context = null;
        }
      }

    } catch (error) {
      log('worker_error', {
        error: error.message
      });
    } finally {
      busy = false;
    }
  }

  timer = setInterval(() => {
    void tick();
  }, INTERVAL_MS);

  void tick();

  log('worker_started', {
    intervalMs: INTERVAL_MS,
    autoSubmit: AUTO_SUBMIT
  });

  return {
    stop: async () => {
      stopped = true;
      clearInterval(timer);

      // Let an in-progress application finish.
      while (busy) {
        await sleep(250);
      }

      await context?.close().catch(() => {});
      context = null;
    }
  };
}
