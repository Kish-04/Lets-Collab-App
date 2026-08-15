const https = require('https');
const fs = require('fs');

const urls = [
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/narhari-motivaras/aws-architecture-icons.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/youritjang/software-architecture.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/youritjang/azure-cloud-services.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/michelcaradec/cloud-design-patterns.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/dbssticky/data-viz.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/cloud/cloud.excalidrawlib',
    'https://raw.githubusercontent.com/excalidraw/excalidraw-libraries/main/libraries/slobodan/aws-serverless.excalidrawlib'
];

urls.forEach((url, i) => {
    https.get(url, res => {
        const file = fs.createWriteStream(`public/libraries/pack${i}.json`);
        res.pipe(file);
    });
});
