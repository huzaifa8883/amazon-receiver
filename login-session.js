
import { chromium } from 'playwright';
import readline from 'node:readline';
import path from 'node:path';
import os from 'node:os';

const HOME_URL = 'https://www.jobsatamazon.co.uk/';

const PROFILE_DIR =
  process.env.AMAZON_PROFILE_PATH ||
  (process.platform === 'win32'
    ? path.join(
        os.homedir(),
        'amazon-receiver',
        '.browser-profile'
      )
    : '/var/www/amazon-bot-system/amazon-receiver/.browser-profile');

const MAX_LOGIN_MINUTES = 15;

function waitForEnterOrTimeout(minutes) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    let finished = false;

    const timer = setTimeout(() => {
      finish('timeout');
    }, minutes * 60 * 1000);

    function finish(reason) {
      if (finished) return;
      finished = true;

      clearTimeout(timer);
      rl.close();
      resolve(reason);
    }

    rl.question(
      '\nAfter logging in, press Enter to save and close.\n',
      () => finish('enter')
    );

    if (!process.stdin.isTTY) {
      finish('noninteractive');
    }
  });
}

async function main() {
  console.log('Amazon UK manual login');
  console.log('Profile:', PROFILE_DIR);

  const context = await chromium.launchPersistentContext(
    PROFILE_DIR,
    {
      headless: false,
      viewport: {
        width: 1366,
        height: 768
      },
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      acceptDownloads: false,
      chromiumSandbox: true
    }
  );

  try {
    const page =
      context.pages()[0] ||
      await context.newPage();

    page.setDefaultNavigationTimeout(45000);

    console.log('Opening:', HOME_URL);

    try {
      const response = await page.goto(HOME_URL, {
        waitUntil: 'domcontentloaded'
      });

      console.log(
        'Initial HTTP status:',
        response?.status() ?? 'unknown'
      );

      if ([403, 429].includes(response?.status())) {
        console.warn(
          'Access restricted by the website. ' +
          'A saved profile will not override this restriction.'
        );
      }
    } catch (error) {
      console.warn(
        'Navigation problem:',
        error.message
      );

      console.log(
        'You can navigate manually in the open browser.'
      );
    }

    console.log(`
Complete the login manually in Chromium.

- Enter your email or username.
- Enter your password.
- Complete any OTP or verification.
- Confirm that the account is signed in.

You have up to ${MAX_LOGIN_MINUTES} minutes.
`);

    const reason = await waitForEnterOrTimeout(
      MAX_LOGIN_MINUTES
    );

    console.log('Closing browser:', reason);

    // Allow Chromium to flush outstanding cookie and
    // profile data before the persistent context closes.
    await page.waitForTimeout(1000);

  } finally {
    await context.close();

    console.log(
      'Browser closed. Persistent profile retained at:',
      PROFILE_DIR
    );
  }
}

main().catch(error => {
  console.error('Login session failed:', error.message);
  process.exitCode = 1;
});
