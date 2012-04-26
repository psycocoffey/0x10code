$(function() {
    var hlLine = 0;
    var editor = window.editor = CodeMirror.fromTextArea(document.getElementById('editor'), {
        lineNumbers: true,
        lineWrapping: true,
        extraKeys: {
            "F11": function() {
                var scroller = $('.CodeMirror-scroll');
                if(!scroller.hasClass('CodeMirror-fullscreen')) {
                    scroller.addClass('CodeMirror-fullscreen');
                    editor.refresh();
                } else {
                    scroller.removeClass('CodeMirror-fullscreen');
                    editor.refresh();
                }
            },
            "Esc": function() {
                var scroller = $('.CodeMirror-scroll');
                scroller.removeClass('CodeMirror-fullscreen');
                editor.refresh();
            }
        },
        onUpdate: function() {
            $('#error').hide();
            $('#run').removeClass('disabled');
            $('#stop').removeClass('disabled');
            $('#reset').removeClass('disabled');
            $('#debug').removeClass('disabled');
            $('#step').removeClass('disabled');
        },
        onCursorActivity: function() {
            if(!editor.getOption('readOnly')) {
	            editor.setLineClass(hlLine, null, null);
	            hlLine = editor.setLineClass(editor.getCursor().line, null, "activeLine");
            }
        }
    });
    $('.CodeMirror').addClass('inset');
    
    $('#savePanel').on('show', function(){ $(this).show(); });
    $('#savePanel').on('hidden', function(){ $(this).fadeOut(); });
    
    var cpu = new DCPU16.CPU(), assembler, notRun = false;
    var instructionMap = [], addressMap = [];
    var pcLine = 0, errorLine = 0;
    var devices = [];
    
    function clearScreen() {
    	ctx.fillStyle = getColor(0);
        ctx.fillRect(0, 0, 500, 500);
    };
    
    function getColor(val) {
    	val &= 0xf;
    	
    	var color;
    	if(palette.start < cpu.ramSize) color = cpu.mem[palette.start + val];
    	else color = defaultPalette[val];
    	
    	var r = ((color & 0xf00) >> 8) * 17;
    	var g = ((color & 0xf0) >> 4) * 17;
    	var b = (color & 0xf) * 17;
    	
    	return 'rgb(' + r +',' + g + ',' + b + ')';
    };
    
    var defaultPalette = [
    	0x000,
    	0x00a,
    	0x0a0,
    	0x0aa,
    	
    	0xa00,
    	0xa0a,
    	0xa50,
    	0xaaa,
    	
    	0x555,
    	0x55f,
    	0x5f5,
    	0x5ff,
    	
    	0xf55,
    	0xf5f,
    	0xff5,
    	0xfff
    ];
    
    var defaultFont = [];
    var charWidth = 4, charHeight = 8;
    var charScale = 3;
    (function() {
	    var fontCanvas = document.getElementById('fontCanvas'); 
	    var fontCtx = fontCanvas.getContext('2d');
	    var fontImage = new Image();
	    fontImage.onload = function() {
	    	fontCtx.drawImage(fontImage, 0, 0);
	    	
	    	for(var i = 0; i < charWidth; i++) {
	    		for(var j = 0; j < 32; j++) {
	    			var fontData = fontCtx.getImageData(j * charWidth, i * charHeight, charWidth, charHeight),
	    				charId = (i * 32) + j;
	    				
	    			for(var k = 0; k < charWidth; k++) {
	    				var col = 0;
	    				for(var l = 0; l < charHeight; l++) {
	    					var pixelId = l * charWidth + k;
	    					col |= (((fontData.data[pixelId * charWidth + 1] > 128) * 1) << l);
	    				}
	    				defaultFont[(charId * 2) + Math.floor(k/2)] |= (col << (((k+1)%2) * charHeight));
	    			}
	    		}
	    	}
	    };
	    fontImage.src = '/img/font.png';
    })();
    
    var canvas = document.getElementById('canvas');     
    var blinkCells = [], cellQueue = [];
    var blinkInterval = 700;
 	var ctx = canvas.getContext('2d');
 	
 	var cols = 32, rows = 12;
 	var borderSize = 6;
 	
 	$('canvas')
 		.attr('width', (charWidth * cols + borderSize * 2) * charScale)
 		.attr('height', (charHeight * rows + borderSize * 2) * charScale);
 		
 	var screen = cpu.onSet(cpu.ramSize, cols * rows, function(key, val) {
 		var row = Math.floor(key / cols), col = key % cols;
        var character = String.fromCharCode(val & 0x7f)
         	.replace(' ', ' ')
           	.replace('\n', ' ')
           	.replace('\r', ' ')
           	.replace('\0', ' ');
           
        queueChar(col, row);
           
        if(((val >> 7) & 1) === 1) blinkCells[row][col] = true;
        else blinkCells[row][col] = false;
 	});
 	
 	var font = cpu.onSet(cpu.ramSize, 128, function(key, val) {
 		if(screen.start < cpu.ramSize) {
	 		var displayRam = cpu.mem.slice(screen.start, screen.end + 1);
	    	var value = Math.floor(key / 2);
	    		
	    	for(var i = 0; i < displayRam.length; i++) {
		    	if((displayRam[i] & 0x7f) === value) {
		    		queueChar(i % cols, Math.floor(i / cols));
		    	}
	    	}
    	}
 	});
 	
 	var palette = cpu.onSet(cpu.ramSize, 16, function(key, val) {
 		if(screen.start < cpu.ramSize) {
	 		var displayRam = cpu.mem.slice(screen.start, screen.end + 1);
	    		
	    	for(var i = 0; i < displayRam.length; i++) {
		    	if(((displayRam[i] & 0xf00) >> 8) === key
		    	|| ((displayRam[i] & 0xf000) >> 12) === key) {
		    		queueChar(i % cols, Math.floor(i / cols));
		    	}
	    	}
    	}
 	});
 
 	var displayDevice = {
 		id: 0x7349f615,
 		version: 0x1802,
 		manufacturer: 0x1c6c8b36,
 		onInterrupt: function() {
 			switch(cpu.mem.a) {
 				// MEM_MAP_SCREEN
 				case 0:
 					if(cpu.mem.b > 0) {
 						screen.start = cpu.mem.b;
 					} else {
 						screen.start = cpu.ramSize;
 					}
 					break;
 					
 				// MEM_MAP_FONT
 				case 1:
 					if(cpu.mem.b > 0) {
 						font.start = cpu.mem.b;
 					} else {
 						font.start = cpu.ramSize;
 					}
 					break;
 					
 				// MEM_MAP_PALETTE
 				case 2:
 					if(cpu.mem.b > 0) {
 						palette.start = cpu.mem.b;
 					} else {
 						palette.start = cpu.ramSize;
 					}
 					break;
 					
 				// SET_BORDER_COLOR
 				case 2:
 					var width = (charWidth * cols + borderSize * 2) * charScale,
		    			height = (charHeight * rows + borderSize * 2) * charScale;
		    		ctx.fillStyle = getColor(cpu.mem.b & 0xf);
		    		ctx.fillRect(0, 0, width, borderSize * charScale);
		    		ctx.fillRect(0, height - borderSize * charScale, width, borderSize * charScale);
		    		ctx.fillRect(0, 0, borderSize * charScale, height);
		    		ctx.fillRect(width - borderSize * charScale, 0, borderSize * charScale, height);
 					break;
 			}
 		}
 	};
 	devices.push(displayDevice);
    
    for(var i = 0; i < rows; i++) {
    	cellQueue.push([]);
    	blinkCells.push([]);
    }
    
    function queueChar(x, y) {
    	cellQueue[y][x] = true;
    };
    
    var blinkVisible = false;
    function drawChar(value, x, y) {
    	var charValue = value & 0x7f,
    		fg = getColor((value >> 12) & 0xf),
            bg = getColor((value >> 8) & 0xf),
            blink = ((value >> 7) & 1) === 1;
    	var fontChar;
    	if(font.start < cpu.ramSize) fontChar = [cpu.mem[font.start+charValue * 2], cpu.mem[font.start+charValue * 2 + 1]];
    	else fontChar = [defaultFont[charValue * 2], defaultFont[charValue * 2 + 1]];
		
		ctx.fillStyle = bg;
		ctx.fillRect((x * charWidth + borderSize) * charScale,
			(y * charHeight + borderSize) * charScale,
			charWidth * charScale, charHeight * charScale);
		
		if(!(blink && !blinkVisible)) {
			for(var i = 0; i < charWidth; i++) {
				var word = fontChar[(i >= 2) * 1];
				var hword = (word >> (!(i%2) * 8)) & 0xff;
	
				for(var j = 0; j < charHeight; j++) {				
					var pixel = (hword >> j) & 1;
					
					if(pixel){
						ctx.fillStyle = fg;
						ctx.fillRect((x * charWidth + i + borderSize) * charScale,
							(y * charHeight + j + borderSize) * charScale,
							charScale, charScale);
					}
				}
			}
		}
    };
    
    function drawLoop() {
    	for(var i = 0; i < rows; i++) {
    		for(var j = 0; j < cols; j++) {
    			var cell = cellQueue[i][j];
    			if(cell && screen.start < cpu.ramSize) {
    				drawChar(cpu.mem[screen.start + (i * cols) + j], j, i);
    				cellQueue[i][j] = false;
    			}
    		}
    	}
    	if(window.requestAnimationFrame) window.requestAnimationFrame(drawLoop);
    	else setTimeout(drawLoop, 16);
    };
    drawLoop();
    
    function blinkLoop() {
    	blinkVisible = !blinkVisible;
    	for(var i = 0; i < rows; i++) {
    		for(var j = 0; j < cols; j++) {
    			if(blinkCells[i][j]) {
    				queueChar(j, i);
    			}
    		}
    	}
    	setTimeout(blinkLoop, blinkInterval);
    };
    blinkLoop();
    
    var clockOn = false, clockInterrupt = false, clockTicks = 0;
    var clock = {
    	id: 0x12d0b402,
    	version: 0,
    	manufacturer: 0,
    	onInterrupt: function() {
    		switch(cpu.mem.a) {
    			case 0:
    				if(cpu.mem.b) {
    					clockTicks = 0;
    					if(!clockOn) clockTick();
    					clockOn = true;
    				} else {
    					clockOn = false;
    				}
    				break;
    				
    			case 1:
    				cpu.mem.c = clockTicks;
    				break;
    			
    			case 2:
    				if(cpu.mem.b) clockInterrupt = true;
    				else clockInterrupt = false;
    				break;
    		}
    	}
    };
    devices.push(clock);
    
    function clockTick() {
    	if(clockInterrupt) {
    		cpu.interrupt(2);
    	}
    	
    	clockTicks++;
    	
    	if(clockOn) setTimeout(clockTick, 1000 / 60);
    };
    
    while(devices.length > 0) {
    	var index = Math.floor(Math.random() * devices.length);
    	cpu.addDevice(devices[index]);
    	devices.splice(index, 1);
    }
    
    function compile() {
        $('#error').hide();
        editor.setLineClass(errorLine, null, null);

        var code = editor.getValue();
        reset();
        assembler = new DCPU16.Assembler(cpu);
        try {
            assembler.compile(code);
            addressMap = assembler.addressMap;
            instructionMap = assembler.instructionMap;
            notRun = true;
            return true;
        } catch(e) {
            $('#error strong').text('Assembler error: ');
            $('#error span').text(e.message);
            if(assembler.instructionMap[assembler.instruction]) {
            	errorLine = editor.setLineClass(assembler.instructionMap[assembler.instruction] - 1, null, 'errorLine');
            }
            $('#error').show();
            return false;
        }
    }

    function reset() {
        cpu.stop();
        $('#debug').removeClass('disabled');
        $('#step').removeClass('disabled');
        $('#run').removeClass('disabled');
        $('#reset').removeClass('disabled');
        cpu.clear();
        clearScreen();
        
        editor.setLineClass(pcLine, null, null);
        editor.setLineClass(errorLine, null, null);
    }
    
    var lastRam, stepped = false;
    function debugLoop() {
    	if($('#debug').hasClass('active') && cpu.running || stepped) {
    		stepped = false;
    		
		    editor.setLineClass(pcLine, null, null);
		    pcLine = editor.setLineClass(assembler.instructionMap[assembler.addressMap[cpu.mem.pc]] - 1, null, 'pcLine');
		    
		    function updateRegister(name) {
		    	$('#' + name + ' .val').text(formatWord(cpu.mem[name]));
		    	$('#' + name + ' .point').text(formatWord(cpu.mem[cpu.mem[name]]));
		    }
		    
		    for(var i = 0; i < REGISTER_NAMES.length; i++) {
		    	updateRegister(REGISTER_NAMES[i]);
		    }
		    updateRegister('pc');
		    updateRegister('o');
		    
		    $('#sp .val').text(formatWord(cpu.mem.sp));
		    $('#sp .point').text(formatWord(cpu.mem[cpu.mem.sp]));
		    
		    $('div.tooltip').remove();
		    
		    var rowN = 0, table = $('#memoryInfo');
		    for(var i = 0; i < cpu.ramSize; i += 8) {
	            var populated = false;
	            for(var j = 0; j < 8; j++) {
	            	if(cpu.mem[i + j] || cpu.mem.pc === i + j || cpu.mem.sp === i + j) {
	                    populated = true;
	                    break;
	                }
	            }
	
	            if(populated) {
	            	var row = table.find('.row' + rowN);
	                if(row.length === 0) {
	                	row = $('<tr class="row' + rowN + '"></tr>');
	                	table.append(row);
	                	row.append('<td class="address"></td>');
	                }
	                
	                row.children('.address').text(formatWord(i));
					
	                for(var j = 0; j < 8; j++) {
	                	if(!lastRam || cpu.mem[i + j] !== lastRam[i + j]) {
		                	var cell = row.children('.cell' + j);
		                	if(cell.length === 0) {
		                		cell = $('<td class="cell' + j + '"></td>');
		                		row.append(cell);
		                	}
		                	
		                	cell.tooltip({
			                	title: editor.getLine(instructionMap[addressMap[j+i]] - 1)
			                });
			                cell.text(formatWord(cpu.mem[i + j]));
	                	}
	                }
	                
	                
	                rowN++;
	            }
	        }
	        lastRam = cpu.mem.slice(0);
	        
	        $('#cycle').text(cpu.cycle);
       }
       setTimeout(debugLoop, 100);
    }
    debugLoop();
    
    cpu.onEnd(function() {
        $('#debug').removeClass('disabled');
        $('#step').removeClass('disabled');
        $('#reset').removeClass('disabled');
        $('#run').removeClass('disabled');
        $('#run span').text('Run');
    });

    $('#run').click(function() {
        if(!$(this).hasClass('disabled')) {
            if(compile()) {
            	notRun = false;
                $('#step').addClass('disabled');
                $('#run').addClass('disabled');
                $('#run span').text('Running...');
                $('#reset').addClass('disabled');
                cpu.run();
            }
        }
    });

    $('#stop').click(function() {
        if(!$(this).hasClass('disabled'))
            cpu.stop();
            stepped = true;
    });
    
    $('#debug').click(function() {
        if(!$('#debug').hasClass('active')) {
            $('#debugIcon').removeClass('icon-chevron-down');
            $('#debugIcon').addClass('icon-chevron-up');
            $('#debugger').collapse('show');
            $('#debugger').css('height', 'auto');
            if(!cpu.running) compile();
        } else {
            $('#debugIcon').removeClass('icon-chevron-up');
            $('#debugIcon').addClass('icon-chevron-down');
            $('#debugger').collapse('hide');
        }
    });

    $('#reset').click(function() {
        if(!$(this).hasClass('disabled')) {
            reset();
            compile();
         }
    });

    $('#step').click(function() {
        if(!$(this).hasClass('disabled')) {
            cpu.step();
		    editor.setLineClass(pcLine, null, null);
		    pcLine = editor.setLineClass(assembler.instructionMap[assembler.addressMap[cpu.mem.pc]] - 1, null, 'pcLine');
        }
    });
    
    $('#info').click(function() {
    	if(!$('#info').hasClass('active')) {
            $('#info i').removeClass('icon-chevron-down');
            $('#info i').addClass('icon-chevron-up');
            $('#savePanel').collapse('show');
        } else {
            $('#info i').removeClass('icon-chevron-up');
            $('#info i').addClass('icon-chevron-down');
            $('#savePanel').collapse('hide');
        }
    });
    
    $('#save').click(function() {
    	var data = {
    		title: $('#saveTitle').val(),
    		author: $('#saveAuthor').val(),
    		description: $('#saveDescription').val(),
    		password: $('#savePassword').val(),
    		code: window.editor.getValue(),
    		id: $('#saveId').val()
    	};
    	if($('#saveFork')) data.fork = $('#saveFork').val();
    	$.post('/', data, function(data) {
    		window.location = data;
    	}, 'text').error(function() {
    		$('#saveAlert').show();
    	});
    });
});
