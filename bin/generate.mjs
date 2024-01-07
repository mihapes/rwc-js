#!/usr/bin/env node
import * as fs from "fs";
import { RwcCompiler } from "../dist/rwc-compiler.cjs";
import path from "path";

let inFile = null;
let inDir = null;
let outDir = null;

for (let i = 0; i < process.argv.length; i++) {
    const arg = process.argv[i];
    switch (arg) {
        case "-f":
            inFile = process.argv[++i];
            break;
        case "-d":
            inDir = process.argv[++i];
            break;
        case "-o":
            outDir = process.argv[++i];
            break;
        case "-h":
            printHelp();
            break;
    }
}

function printHelp() {
    console.log("TODO: help");
    process.exit(0);
}

if (outDir !== null) {
    try {
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir);
        }
    } catch (err) {
        console.error(err);
        process.exit(0);
    }
}

if (inFile !== null) {
    const _inDir = path.dirname(inFile) + "/";
    const _inFile = path.basename(inFile);
    generateComponent(_inFile, _inDir, outDir);
}

if (inDir !== null) {
    if (!fs.existsSync(inDir)) {
        console.error("inDir does not exist. Exiting.");
        process.exit(0);
    }
    fs.readdirSync(inDir).forEach((file) => {
        generateComponent(file, inDir, outDir);
    });
}

function generateComponent(file, _inDir, _outDir) {
    if (path.extname(file) !== ".rwc") {
        return;
    }
    if (_outDir === null) {
        _outDir = _inDir;
    }
    const compiler = new RwcCompiler();
    console.log("Generating: " + file);
    const src = fs.readFileSync(_inDir + file, "utf-8");
    const component = compiler.generateWebComponent(src);
    if (component === null) {
        console.error("Someting went wrong. Component not generated.");
        return;
    }
    fs.writeFileSync(`${_outDir}${file.split(".")[0]}.js`, component, {
        encoding: "utf-8",
    });
}
