let path = require('path');
let fs = require('fs');
let os = require('os');
let child_process = require('child_process');

function setVariable(name, value) {
    console.log(`Setting variable: ${name} = ${value}`);
    console.log(`##vso[task.setvariable variable=${name}]${value}`);
}

function getFullPackFilePath() {
    return path.join(process.env.CACHE_PATH, `_cache.${os.platform() === 'win32' ? 'zip' : 'tar'}`);
}

function handleInit() {
    let cachePackTool = os.platform() === 'win32' ? '7z' : 'tar';
    
    // TODO: should check if the pack tool exists or not
    // TODO: not sure how to update a multi-line environment variable using ##vso
    //   console.log('Updating cache key to indicate pack tool');
    //    setVariable('CACHE_KEY', `${process.env.CACHE_KEY}\nwillsmythe.pack=${cachePackTool}`);
    
    console.log('Setting CACHE_PACK_TOOL and CACHE_PACK_TOOLS_DIR');
    setVariable('CACHE_PACK_TOOL', cachePackTool);
    setVariable('CACHE_PACK_TOOLS_DIR', process.cwd());
}

function handlePreRestore() {
    console.log('Creating directory for pack file...');
    let tempCachePath = fs.mkdtempSync(process.env.PIPELINE_WORKSPACE);
    console.log(`  Pack directory: ${tempCachePath}`);
    console.log('Setting CACHE_PATH_ORIGINAL and CACHE_PATH variables');
    setVariable('CACHE_PATH_ORIGINAL', process.env.CACHE_PATH);
    setVariable('CACHE_PATH', tempCachePath);
    setVariable('CACHE_RESTORED', '');
}

function handlePostRestore() {
    let cacheRestored = process.env.CACHE_RESTORED;
    cacheRestored = (cacheRestored && cacheRestored == 'true');

    if (!cacheRestored) {    
        console.log('Cache was not restored.');
        return;
    }

    let packFilePath = getFullPackFilePath();

    console.log(`Checking for pack file: ${packFilePath}`); 
    if (!fs.existsSync(packFilePath)) {
        throw new Error(`Attempting to restore, but cannot find pack file: ${packFilePath}`);
    }

    let packTool = process.env.CACHE_PACK_TOOL;
    let restorePath = process.env.CACHE_PATH_ORIGINAL;

    try {
        console.log(`Attempt to create restore path directory: ${restorePath}`);
        fs.mkdirSync(restorePath, { recursive: true } );
    } catch (e) {}

    let cmd;
    if (packTool === 'tar') {
        cmd = `tar -xvf ${packFilePath}`;
    } else if (packTool === '7z') {
        cmd = `7z x ${packFilePath}`;
    } else {
        throw new Error(`Unknown pack tool: ${packTool}`);
    }

    console.log(`Extracting pack file into cache path with "${cmd}"`);
    child_process.execSync(cmd, { cwd: restorePath });
}

function handlePreSave() {
    let packTool = process.env.CACHE_PACK_TOOL;
    let packFilePath = getFullPackFilePath();
    
    let cmd;
    if (packTool === 'tar') {
        cmd = `tar -cvpf ${packFilePath} .`;
    } else if (packTool === '7z') {
        cmd = `7z a ${packFilePath} -mx=1 *`;
    } else {
        throw new Error(`Unknown pack tool: ${packTool}`);
    }
    console.log(`Creating pack file with "${cmd}"`);
    child_process.execSync(cmd, { cwd: process.env.CACHE_PATH_ORIGINAL });

    if (!fs.existsSync(packFilePath)) {
        throw new Error(`Pack file not found: ${packFilePath}`);
    }
}

function run() {
    //console.log(`${JSON.stringify(process.env, null, 2)}`);
    //#console.log(`pwd: ${process.cwd()}`);

    if (process.argv.length <= 2) {
        console.error('Missing command!');
        process.exit(1);
    }

    let action = process.argv[2];

    switch (action) {
        case 'init':
            handleInit();
            break;
        case 'pre-restore':
            handlePreRestore();
            break;
        case 'post-restore':
            handlePostRestore();
            break;
        case 'pre-save':
            handlePreSave();
            break;
        default:
            throw new Error('Unknown command: ${command}');
    }
}

run();
