const puppeteer = require('puppeteer');
(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err));
    await page.goto('https://letscollab-nj7udtg54-kishankarthiks222-4130s-projects.vercel.app/session?room=test');
    await page.waitForSelector('button[title="Toggle Canvas Mode"]', { timeout: 10000 });
    await page.click('button[title="Toggle Canvas Mode"]');
    await new Promise(r => setTimeout(r, 15000));
    await browser.close();
})();
