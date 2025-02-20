/*
 * Copyright (C) 2017-2019 HERE Europe B.V.
 * Licensed under Apache 2.0, see full license in LICENSE
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "fs";
import * as fse from "fs-extra";
import * as glob from "glob";
import * as path from "path";
import { accessToken } from "../@here/harp-examples/config";

/*
Simple script that extracts all code snippets from examples
*/

// counts the leading spaces in a string
function countLeadingSpaces(line: string): number {
    let result = 0;
    for (const char of line) {
        if (char !== " ") {
            return result;
        }
        ++result;
    }
    return result;
}

// remove empty lines from top and bottom of snippet
function chop(lines: string[]) {
    while (lines[0] === "") {
        lines.shift();
    }
    while (lines[-1] === "") {
        lines.pop();
    }
}

function reindented(spaces: number, lines: string[]): string[] {
    if (spaces === 0) {
        return lines;
    }

    const prefix = " ".repeat(spaces);
    return lines.map(line => (line.startsWith(prefix) ? line.substring(spaces) : line));
}

// tslint:disable-next-line:no-var-requires
const mkpath = require("mkpath");

const sdkDir = path.resolve(__dirname, "..");
const outDir = path.resolve(sdkDir, "dist/doc-snippets");
const distOutDir = path.resolve(sdkDir, "dist/doc");
const distDocsOutDir = path.resolve(distOutDir, "docs");

mkpath.sync(outDir);
mkpath.sync(distOutDir);
mkpath.sync(distDocsOutDir);

const sourceFiles = glob.sync(sdkDir + "/@here/harp-examples/**/*.{ts,tsx,html}");

const snippetRegex = /snippet:(\S+).*$([\s\S]*)^.*end:\1/gm;

for (const sourceFile of sourceFiles) {
    const contents = fs.readFileSync(sourceFile, { encoding: "utf8" });

    let match;
    // tslint:disable-next-line:no-conditional-assignment
    while ((match = snippetRegex.exec(contents)) !== null) {
        const fileName = match[1];
        const snippet = match[2];

        const lines = snippet.split("\n");
        chop(lines);

        if (lines.length === 0) {
            // tslint:disable-next-line:no-console
            console.error("ERROR: snippet", snippet, "in", fileName, "too short");
            continue;
        }

        // reindent the snippet
        const leadingSpaces = countLeadingSpaces(lines[0]);
        const result = reindented(leadingSpaces, lines).join("\n");

        fs.writeFileSync(path.resolve(outDir, fileName), result, { encoding: "utf8" });
        // tslint:disable-next-line:no-console
        console.log("generated", fileName, path.resolve(outDir, fileName));
    }
}

fs.copyFileSync(path.join(sdkDir, "LICENSE"), path.join(outDir, "LICENSE"));
fs.copyFileSync(path.join(sdkDir, "docs/index.html"), "dist/index.html");
fse.copySync(path.join(sdkDir, "docs/resources"), "dist/resources");
fse.copySync(path.join(sdkDir, "docs/css"), "dist/css");
fse.copySync(path.join(sdkDir, "docs/js"), "dist/js");
fse.copySync(path.join(sdkDir, "docs/examples"), "dist/redirect_examples");
fse.copySync(path.join(sdkDir, "docs/docs"), "dist/redirect_docs");
fs.copyFileSync(path.join(sdkDir, "LICENSE"), path.join(distOutDir, "LICENSE"));
fse.copySync(path.join(sdkDir, "docs"), distDocsOutDir);
fs.writeFileSync("dist/_config.yml", 'include:\n  - "_*"\n', { encoding: "utf8" });

const credentialsResult = `const token = '${accessToken}'`;
fs.writeFileSync("dist/js/credentials.js", credentialsResult, { encoding: "utf8" });
