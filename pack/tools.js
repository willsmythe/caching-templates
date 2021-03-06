const path = require('path');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');

function convertToPosixStylePath(p) {
    if (os.platform() === 'win32' && p[1] == ':') {
        return '/' + p.substring(0, 1).toLowerCase() + p.substring(1).replace(/\\/g, '/').replace(':', '');
    } else {
        return p;
    }
}

// "c" is something like PACK_FORMATS.tar.commands.pack
function getCommand(cmd, packFile) {
    if (cmd instanceof Function) {
        return cmd(packFile); // call custom function that returns the command
    } else {
        return cmd.replace('$0', packFile); // insert the path to the .tar/zip file
    }
}

const PACK_FORMATS = {
    tar: {
        extension: 'tar',
        commands: {
            pack: (packFile) => {
                return `tar -cvpf ${convertToPosixStylePath(packFile)} .`;
            },
            unpack: (packFile) => {
                return `tar -xvf ${convertToPosixStylePath(packFile)}`;
            }
        }    
    },
    zip: {
        extension: 'zip',
        commands: {
            pack: '7z a $0 -mx=1 *',
            unpack: '7z x $0 -aoa'
        }
    },
    '7z': {
        extension: '7z',
        commands: {
            pack: '7z a $0 -mx=1 *',
            unpack: '7z x $0 -aoa'
        }
    },
    '7z-split': {
        extension: '7z',
        commands: {
            pack: '7z a $0 -mx=1 -v32m *',    // 7z a a.7z *.txt -v20m
            unpack: '7z x $0 -t7z.split -aoa' // 7z x a.7z.001 -t7z.split
        },
        getActualPackFilePath: function(defaultPackFilePath) {
            // path to the actual/existing file on disk (which will be something like _cache.7z.001)
            return `${defaultPackFilePath}.001`;
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
function getPackFile(returnActual = false) {
    const format = getPackFormat();
    if (!format) {
        throw new Error('Unknown pack format. Set CACHE_PACK_FORMAT to a supported format (or unset it).');
    }

    const defaultFilePath = path.join(process.env.CACHE_PATH, `_cache.${format.extension}`);
    if (returnActual && format.getActualPackFilePath) {
        return format.getActualPackFilePath(defaultFilePath)
    } else {
        return defaultFilePath;
    }
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

    const tempPath = process.env.CACHE_PACK_TEMP || process.env.PIPELINE_WORKSPACE;

    console.log(`Creating temporary directory for pack file under ${tempPath}`);
    try {
        fs.mkdirSync(tempPath, { recursive: true } );
    } catch (e) {}
    const tempCachePath = fs.mkdtempSync(tempPath);
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
    
    const packFile = getPackFile(true);
    const packFormat = getPackFormat();

    console.log(`Checking for pack file: ${packFile}`); 
    if (!fs.existsSync(packFile)) {
        throw new Error(`Attempting to restore, but cannot find pack file. Did you forget to update CACHE_KEY to something new?: ${packFile}`);
    }
    
    const unpackTargetPath = process.env.CACHE_PATH_ORIGINAL;

    // Create the directory (if necessary) that files will be unpacked to
    try {
        console.log(`Attempting to create restore path directory: ${unpackTargetPath}`);
        fs.mkdirSync(unpackTargetPath, { recursive: true } );
    } catch (e) {}

    // Unpack the pack file from the cache
    const cmd = getCommand(packFormat.commands.unpack, packFile);
    console.log(`Unpacking into cache path with "${cmd}"`);
    child_process.execSync(cmd, { cwd: unpackTargetPath });
}

// create the pack file in anticipation of the "save cache" step
function handlePreSave() {
    checkVariables(['CACHE_PATH', 'CACHE_PATH_ORIGINAL']);

    // Create a pack file for the cached contents
    const packFormat = getPackFormat();
    const packFile = getPackFile();
    const packSourcePath = process.env.CACHE_PATH_ORIGINAL;
    const cmd = getCommand(packFormat.commands.pack, packFile);

    console.log(`Creating pack file with "${cmd}"`);
    child_process.execSync(cmd, { cwd: packSourcePath });

    // Verify the pack file was created
    const actualPackFilePath = getPackFile(true);
    if (!fs.existsSync(actualPackFilePath)) {
        throw new Error(`Pack file not found: ${actualPackFilePath}`);
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
