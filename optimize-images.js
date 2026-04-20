// One-off: resize + re-encode every product JPEG under public/images/.
// Leaves logo.jpg / logo.png untouched.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const DIR = path.join(__dirname, 'public', 'images');
const TARGET_WIDTH = 600;
const QUALITY = 82;

async function main() {
    const files = fs.readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f) && !/^logo\./i.test(f));
    let totalBefore = 0, totalAfter = 0;

    for (const file of files) {
        const full = path.join(DIR, file);
        const before = fs.statSync(full).size;
        const tmp = full + '.tmp';

        await sharp(full)
            .rotate() // respect EXIF orientation
            .resize({ width: TARGET_WIDTH, withoutEnlargement: true })
            .jpeg({ quality: QUALITY, mozjpeg: true })
            .toFile(tmp);

        fs.renameSync(tmp, full);
        const after = fs.statSync(full).size;
        totalBefore += before;
        totalAfter += after;
        console.log(`${file.padEnd(40)}  ${(before/1024).toFixed(0).padStart(5)}KB -> ${(after/1024).toFixed(0).padStart(5)}KB`);
    }

    const pct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    console.log(`\n${files.length} files processed.`);
    console.log(`Total: ${(totalBefore/1024/1024).toFixed(2)}MB -> ${(totalAfter/1024/1024).toFixed(2)}MB  (${pct}% smaller)`);
}

main().catch(err => { console.error(err); process.exit(1); });
