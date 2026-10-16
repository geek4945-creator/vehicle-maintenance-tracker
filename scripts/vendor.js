// Copies the bundled Excel library (ExcelJS, MIT) from node_modules into www/vendor so the app has no CDN dependency.
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'www/vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/exceljs/dist/exceljs.min.js'), path.join(root, 'www/vendor/exceljs.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/exceljs/LICENSE'), path.join(root, 'www/vendor/exceljs-LICENSE.txt'));
console.log('vendored exceljs', require(path.join(root, 'node_modules/exceljs/package.json')).version);
