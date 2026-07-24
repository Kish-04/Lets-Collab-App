const puppeteer = require('puppeteer');
(async () => {
    console.log('Starting puppeteer to test Vercel click...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', error => console.log('BROWSER ERROR:', error.message));
    console.log('Navigating to vercel app...');
    try {
        await page.goto('https://letscollab-pearl.vercel.app/session?create=true&mode=collaboration', { waitUntil: 'networkidle2' });
        console.log('Page loaded!');
        await page.type('input', 'Test Session');
        await page.click('button');
        console.log('Clicked start session!');
        await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
        console.error('Failed:', e);
    }
    await browser.close();
})();
