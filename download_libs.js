const https = require('https');
const fs = require('fs');

const urls = [
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/narhari-motivaras/aws-architecture-icons.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/youritjang/software-architecture.excalidrawlib'
];

urls.forEach((url, i) => {
    https.get(url, res => {
        const file = fs.createWriteStream(`public/libraries/pack${i}.json`);
        res.pipe(file);
    });
});
