const https = require('https');
const fs = require('fs');

const urls = [
    'https://libraries.excalidraw.com/libraries/BjoernPeters/cloud-architecture-aws.excalidrawlib',
    'https://libraries.excalidraw.com/libraries/daniele-russo/lucide-icons.excalidrawlib',
    'https://libraries.excalidraw.com/libraries/BjoernPeters/software-architecture.excalidrawlib'
];

urls.forEach((url, i) => {
    https.get(url, res => {
        const file = fs.createWriteStream(`public/libraries/pack${i}.json`);
        res.pipe(file);
    });
});
