
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
  return new Promise((resolve) => {
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
      '\nOnce you finish logging in, press ENTER to save the session and close Chromium.\n',
      () => finish('enter')
    );

    if (!process.stdin.isTTY) {
      finish('noninteractive');
    }
  });
}

async function main() {
  console.log('====================================');
  console.log(' Amazon UK - Manual Login Session');
  console.log('====================================');

  console.log('Profile directory:', PROFILE_DIR);
  console.log('Website:', HOME_URL);

  let context;

  try {
    context = await chromium.launchPersistentContext(
      PROFILE_DIR,
      {
        headless: false,

        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox'
        ],

        chromiumSandbox: false,

        viewport: {
          width: 1366,
          height: 768
        },

        locale: 'en-GB',
        timezoneId: 'Europe/London',
        acceptDownloads: false
      }
    );

    console.log('Chromium launched successfully.');

    const page =
      context.pages()[0] ||
      await context.newPage();

    page.setDefaultNavigationTimeout(45000);

    try {
      const response = await page.goto(HOME_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      const httpStatus = response?.status() ?? null;

      console.log('Website HTTP status:', httpStatus);

      if (httpStatus === 403 || httpStatus === 429) {
        console.warn(
          'WARNING: Website access restricted. ' +
          'The browser profile cannot override this restriction.'
        );
      }
    } catch (error) {
      console.warn(
        'Navigation failed:',
        error.message
      );

      console.log(
        'You may navigate manually inside the browser.'
      );
    }

    console.log('\nManual login instructions:');
    console.log('1. Sign in with your Amazon account.');
    console.log('2. Complete any OTP or verification.');
    console.log('3. Verify that you are logged in.');
    console.log('4. Return to this terminal and press ENTER.');
    console.log(`\nMaximum login time: ${MAX_LOGIN_MINUTES} minutes.`);

    const reason = await waitForEnterOrTimeout(
      MAX_LOGIN_MINUTES
    );

    console.log('Closing browser. Reason:', reason);

    await page.waitForTimeout(1000).catch(() => {});

  } catch (error) {
    console.error(
      'Login session error:',
      error.message
    );

    process.exitCode = 1;

  } finally {
    if (context) {
      await context.close().catch((error) => {
        console.error(
          'Failed to close Chromium:',
          error.message
        );
      });
    }

    console.log('====================================');
    console.log(' Browser closed');
    console.log(' Profile location:', PROFILE_DIR);
    console.log('====================================');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exitCode = 1;
});
