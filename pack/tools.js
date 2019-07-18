const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');

const PACK_FORMATS = {
    tar: {
        extension: 'tar',
        commands: {
            pack: 'tar -cvpf $0 .',
            unpack: 'tar -xvf $0'
        }        
    },
    zip: {
        extension: 'zip',
        commands: {
            pack: '7z a $0 -mx=1 *',
            unpack: '7z x $0'
        }
    }
}

// Set an environment variable (for later steps) in Azure Pipelines
function setVariable(name, value) {
    console.log(`Setting environment variable '${name}' to '${value}'`);
    console.log(`##vso[task.setvariable variable=${name}]${value}`);
}

// Get the pack format to use, defaults to tar on posix and zip on Windows
function getPackFormat() {
    let format = process.env.CACHE_PACK_FORMAT;

    if (format && PACK_FORMATS[format]) {
        return PACK_FORMATS[format]
    } else if (os.platform() === 'win32') {
        return PACK_FORMATS.zip;
    } else {
        return PACK_FORMATS.tar;    
    }    
}

// Full path to the "pack" file (.tar or .zip)
function getPackFilePath() {
    const format = getPackFormat();
    if (!format) {
        throw new Error('Unknown pack format. Set CACHE_PACK_FORMAT to a supported format (or unset it).');
    }

    return path.join(process.env.CACHE_PATH, `_cache.${format.extension}`);
}

function checkVariables(requiredVariables, throwOnMissing = true) {
    const missingVariables = [];

    requiredVariables.forEach(name => {
        if (!process.env[name]) {
            missingVariables.push(name);
        }
    });

    if (missingVariables.length > 0) {
        const message = `Missing required variables: ${requiredVariables.join(', ')}`;
        if (throwOnMissing) {
            throw new Error(message);
        } else {
            console.log(message);
            return false;
        }
    } else {
        return true;
    }
}

function handleInit() {
    if (!checkVariables(['CACHE_PATH', 'CACHE_KEY'], false)) return;

    console.log('Initializing CACHE_PACK_TOOLS_DIR and CACHE_PACK_TOOLS_INIT');
    
    setVariable('CACHE_PACK_TOOLS_DIR', process.cwd());
    setVariable('CACHE_PACK_TOOLS_INIT', true);

    // TODO: should check if the pack tool exists or not
    // TODO: not sure how to update a multi-line environment variable using ##vso
    //   console.log('Updating cache key to indicate pack tool');
    //    setVariable('CACHE_KEY', `${process.env.CACHE_KEY}\nwillsmythe.pack=${cachePackTool}`);
}

// save CACHE_PATH as CACHE_PATH_ORIGINAL and set CACHE_PATH to a temporary directory where the pack file will be
function handlePreRestore() {
    checkVariables(['PIPELINE_WORKSPACE', 'CACHE_PATH']);

    console.log('Creating temporary directory for pack file under PIPELINE_WORKSPACE...');
    const tempCachePath = fs.mkdtempSync(process.env.PIPELINE_WORKSPACE);
    console.log(`  Pack directory: ${tempCachePath}`);

    console.log('Setting CACHE_PATH_ORIGINAL and CACHE_PATH environment variables');
    setVariable('CACHE_PATH_ORIGINAL', process.env.CACHE_PATH);
    setVariable('CACHE_PATH', tempCachePath);
    setVariable('CACHE_RESTORED', '');
}

// unpack the file downloaded by the "restore cache" step
function handlePostRestore() {
    checkVariables(['CACHE_PATH', 'CACHE_PATH_ORIGINAL']);

    const cacheRestored = process.env.CACHE_RESTORED == 'true';

    if (!cacheRestored) {    
        console.log('Cache was not restored. Not attempting to unpack.');
        return;
    }

    const packFilePath = getPackFilePath();

    console.log(`Checking for pack file: ${packFilePath}`); 
    if (!fs.existsSync(packFilePath)) {
        throw new Error(`Attempting to restore, but cannot find pack file: ${packFilePath}`);
    }
    
    const unpackTargetPath = process.env.CACHE_PATH_ORIGINAL;

    // Create the directory (if necessary) that files will be unpacked to
    try {
        console.log(`Attempting to create restore path directory: ${unpackTargetPath}`);
        fs.mkdirSync(unpackTargetPath, { recursive: true } );
    } catch (e) {}

    // Unpack the pack file from the cache
    const packFormat = getPackFormat();
    const cmd = packFormat.commands.unpack.replace('$0', packFilePath); // insert the path to the .tar/zip file
    console.log(`Unpacking into cache path with "${cmd}"`);
    child_process.execSync(cmd, { cwd: unpackTargetPath });
}

// create the pack file in anticipation of the "save cache" step
function handlePreSave() {
    checkVariables(['CACHE_PATH', 'CACHE_PATH_ORIGINAL']);

    // Create a pack file for the cached contents
    const packFilePath = getPackFilePath();
    const packFormat = getPackFormat();
    const packSourcePath = process.env.CACHE_PATH_ORIGINAL;
    const cmd = packFormat.commands.pack.replace('$0', packFilePath); // insert the path to the .tar/zip file

    console.log(`Creating pack file with "${cmd}"`);
    child_process.execSync(cmd, { cwd: packSourcePath });

    // Verify the pack file was created
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
