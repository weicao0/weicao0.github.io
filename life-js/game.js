// GAME.JS
//

// presets
let presets = {
    'spinners': [
        [0,0], [0,1], [0,2]
    ],

    'spaceship': [
        [0,0], [0,3],
        [1,4],[2,4], [3,4],
        [2,0], [3,1], [3,2], [3,3]
    ],

    'gosper': [ // TODO
        // left square
        [4,0], [4,1], [5,0], [1],

        // left internal pattern, row by row
        [2,12], [2,13],
        [3,11], [3,15],
        [4,10], [4,16],
        [5,10], [5,14], [5,16], [5,17],
        [6,10], [6,16],
        [7,11], [7,15],
        [8,12], [8,13],

        // right internal pattern, row by row
        [0,24],
        [1,22], [1,24],
        [2,20], [2,21],
        [3,20], [3,21],
        [4,20], [4,21],
        [5,22], [5,24],
        [6,24],

        // right square
        [2,34], [2,35], [3,34], [3,35]
    ]
};

// grids
let grids = {
    '50x30': [50, 30],
    '100x50': [100, 50],
    '25x10': [25,10]
};

// these will be set once DOM is ready
let gridwidth = 0;
let gridheight = 0;

// initialize state array (will set to zero later)
let state = [];

// initialize memory
let memory = [];

// game tracking variables
isRunning = false;
numSteps = 0;


// set grid width/height and cellsize to preset
function setGridDimensions(grid_setting) {
    gridwidth = grids[grid_setting][0];
    gridheight = grids[grid_setting][1];
    document.documentElement.style.setProperty('--gridwidth', gridwidth);
    document.documentElement.style.setProperty('--gridheight', gridheight);
    document.documentElement.style.setProperty('--cellsize', `${1000 / gridwidth}px`);
}


// zero out entire state array
function clearState() {
    state = Array(gridheight).fill(0).map(x => Array(gridwidth).fill(0));
}

function resetState() {
    clearState();

    for (let i=0; i<gridheight; i++) {
        for (let j=0; j<gridwidth; j++) {
            state[i][j] = memory[i][j];
        }
    }
}


// initializes all cells in the grid
function initGrid($grid) {
    // make sure $grid is empty
    $grid.empty();

    for (let i=0; i<gridheight; i++) { // row
        for (let j=0; j<gridwidth; j++) { // col
            // define this cell
            let $cell = $('<div>').addClass('cell');
            $cell.attr('id', `cell_${i}_${j}`);

            if (state[i][j] > 0) {
                $cell.addClass('active');
            } 

            // define click as turning on/off cell
            $cell.click(function(e) {
                // only register click if we're paused
                if (!isRunning) {
                    // swap cell state
                    state[i][j] = state[i][j]==1 ? 0 : 1;

                    // turn on/off cell div
                    state[i][j]==1 ? $(this).addClass('active') : $(this).removeClass('active');
                }
            });

            $cell.hover(function(e) {
                $('#xyloc').html(`(${j}, ${i})`);
            }, function(e) {
                $('#xyloc').html('&nbsp');
            });

            // append this cell to grid
            $grid.append($cell);
        }
    }    
}


// deactivate all cells
function clearCells() {
    $('.cell').removeClass('active');
}

function resetCells() {
    clearCells();
    for (let i=0; i<gridheight; i++) {
        for (let j=0; j<gridwidth; j++) {
            if (state[i][j] == 1) {
                $(`#cell_${i}_${j}`).addClass('active');
            }
        }
    }
}


// load a preset (state and viz)
function loadPreset(preset_str, offset) {
    for (let p of presets[preset_str]) {
        let row = p[0] + offset;
        let col = p[1] + offset;
        
        state[row][col] = 1;
        $(`#cell_${row}_${col}`).addClass('active');
    }
}

function isAlive(row, col) {
    // check if (x,y) within grid
    if (row < 0 || col < 0 || row >= gridheight || col >= gridwidth) {
        return 0;
    }

    return state[row][col]==1 ? 1 : 0;
}

function step() {
    // if we're paused, stop
    if (!isRunning) {
        return;
    }

    // create temp state to store active/non for next step
    let temp = Array(gridheight).fill(0).map(x => Array(gridwidth).fill(0));

    // check surrounding
    for (let i=0; i<gridheight; i++) {
        for (let j=0; j<gridwidth; j++) {
            // count the surrounding population
            let numAlive = 0;
            for (let m=-1; m<=1; m++) {
                for (let n=-1; n<=1; n++) {
                    numAlive += isAlive(i+m, j+n);
                }
            }
            numAlive -= isAlive(i,j); // don't count center

            // game logic
            if (numAlive == 2) { // do nothing
                temp[i][j] = state[i][j];
            } else if (numAlive == 3) { // make alive
                temp[i][j] = 1;
            } else { // make dead
                temp[i][j] = 0;
            }
        }
    }

    // apply new state to state
    for (let i=0; i<gridheight; i++) {
        for (let j=0; j<gridwidth; j++) {
            state[i][j] = temp[i][j];

            // apply to viz
            let $c = $(`#cell_${i}_${j}`);
            if (state[i][j] == 1) {
                $c.addClass('active');
            } else {
                $c.removeClass('active');
            }
        }
    }

    // update state counter
    numSteps++;
    $('#stepcounter').html(`Step: ${numSteps}`);

    // take another step
    setTimeout( () => {
        step();
    }, 100);
}

function random(p) {
    // stop the game
    isRunning = false;

    // clear all cells
    clearState();
    clearCells();

    // make proportion `p` of cells active
    for (let i=0; i<gridheight; i++) {
        for (let j=0; j<gridwidth; j++) {
            if (Math.random() < p) {
                $(`#cell_${i}_${j}`).addClass('active');
                state[i][j] = 1;
            }
        }
    }
}

// on DOM ready
$(document).ready(function() {
    
    // set css variables in :root
    setGridDimensions('50x30');

    // initialize grid state to zeros
    clearState();
    
    // initialize the grid
    initGrid($('#grid'));

    // load a simple preset
    loadPreset('spaceship', 5);

    // RUN button
    $('#btn_run').click(function(e) {
        if (isRunning) {
            return;  // if we're already running, do nothing
        }

        // save current state
        memory = Array(gridheight).fill(0).map(x => Array(gridwidth).fill(0));
        for (let i=0; i<gridheight; i++) {
            for (let j=0; j<gridwidth; j++) {
                memory[i][j] = state[i][j];
            }
        }

        // need to set this outside the step(), which is called internally
        isRunning = true;
        step();
    });

    // PAUSE button
    $('#btn_pause').click(function(e) {
        isRunning = false;
    });

    // RESET button
    $('#btn_reset').click(function(e) {
        isRunning = false;
        numSteps = 0;
        $('#stepcounter').html(`Step: ${numSteps}`);

        resetState();
        resetCells();
    });

    // CLEAR button
    $('#btn_clear').click(function(e) {
        isRunning = false;
        numSteps = 0;
        $('#stepcounter').html(`Step: ${numSteps}`);

        clearState();
        clearCells();
    });

    // RANDOM button
    $('#btn_random').click(function(e) {
        random(0.2); 
    });


    // set presets behavior
    Object.keys(presets).forEach(function(key) {
        $(`#preset-${key}`).click(function(e) {
            // stop the game
            isRunning = false;

            // clear all cells
            clearState();
            clearCells();

            // fill the state
            loadPreset(key, 3);
        });
    });

    // set grid presets behavior
    Object.keys(grids).forEach(function(key) {
        $(`#grid-${key}`).click(function(e) {
            // stop the game
            isRunning = false;

            // change grid size
            setGridDimensions(key);
            $('.grids').removeClass('selected');
            $(this).addClass('selected');

            // reset state
            clearState();

            // re-initialize the grid
            initGrid($('#grid'));

            // inactivate cells
            clearCells();
        });
    });

});
