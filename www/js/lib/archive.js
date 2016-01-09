/**
 * archive.js : Class for a local Evopedia archive, with the algorithms to read it
 * This file handles finding a title in an archive, reading an article in an archive etc
 * 
 * Copyright 2013-2014 Mossroy and contributors
 * License GPL v3:
 * 
 * This file is part of Evopedia.
 * 
 * Evopedia is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * Evopedia is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 * 
 * You should have received a copy of the GNU General Public License
 * along with Evopedia (file LICENSE-GPLv3.txt).  If not, see <http://www.gnu.org/licenses/>
 */
'use strict';
define(['normalize_string', 'geometry', 'title', 'util', 'titleIterators', 'q'],
 function(normalize_string, geometry, evopediaTitle, util, titleIterators, q) {
        
    // Declare the webworker that can uncompress with bzip2 algorithm
    var webworkerBzip2;
    try {
        // When using the application normally
        webworkerBzip2 = new Worker("js/lib/webworker_bzip2.js");
    }
    catch(e) {
        // When using unit tests
        webworkerBzip2 = new Worker("www/js/lib/webworker_bzip2.js");
    }
    
    // Size of chunks read in the dump files : 128 KB
    var CHUNK_SIZE = 131072;
    // A rectangle representing all the earth globe
    var GLOBE_RECTANGLE = new geometry.rect(-181, -91, 362, 182);
        
    /**
     * LocalArchive class : defines an Evopedia dump on the filesystem
     * 
     * @typedef LocalArchive
     * @property {Array.<File>} _dataFiles Array of the data files
     * @property {Array.<File>} _coordinateFiles Array of the coordinate files
     * @property {File} _titleFile File that list all the titles
     * @property {File} _mathIndexFile File that indexes the math images
     * @property {Date} _date When the archive as been built
     * @property {String} _language Language used by the archive
     * @property {File} _titleSearchFile File that allows infix search
     * @property {Boolean} _normalizedTitles Are the titles normalized in the archive?
     */
    function LocalArchive() {
        this._dataFiles = new Array();
        this._coordinateFiles = new Array();
        this._titleFile = null;
        this._mathIndexFile = null;
        this._mathDataFile = null;
        this._date = null;
        this._language = null;
        this._titleSearchFile = null;
        this._normalizedTitles = true;
    };

    LocalArchive.prototype.isReady = function() {
        return this._titleFile !== null && this._dataFiles && this._dataFiles.length > 0;
    };
    
    LocalArchive.prototype.needsWikimediaCSS = function() {
        return true;
    };

    LocalArchive.prototype.hasCoordinates = function() {
        return (this._coordinateFiles !== null && this._coordinateFiles.length > 0);
    };

    LocalArchive.prototype.parseTitleId = function(titleId) {
        return evopediaTitle.Title.parseTitleId(this, titleId);
    };

    /**
     * Read the title Files in the given directory, and assign them to the
     * current LocalArchive
     * 
     * @param {StorageFirefoxOS|StoragePhoneGap} storage
     * @param directory
     */
    LocalArchive.prototype.readTitleFilesFromStorage = function(storage, directory) {
        var currentLocalArchiveInstance = this;
        storage.get(directory + 'titles.idx').then(function(file) {
            currentLocalArchiveInstance._titleFile = file;
        }, function(error) {
            alert("Error reading title file in directory " + directory + " : " + error);
        });
        storage.get(directory + 'titles_search.idx').then(function(file) {
            currentLocalArchiveInstance._titleSearchFile = file;
        }, function(error) {
            // Do nothing : this file is not mandatory in an archive
        });
    };

    /**
     * Read the data Files in the given directory (starting at given index), and
     * assign them to the current LocalArchive
     * 
     * @param storage
     * @param directory
     * @param index
     */
    LocalArchive.prototype.readDataFilesFromStorage = function(storage, directory, index) {
        var currentLocalArchiveInstance = this;

        var prefixedFileNumber = "";
        if (index < 10) {
            prefixedFileNumber = "0" + index;
        } else {
            prefixedFileNumber = index;
        }
        storage.get(directory + 'wikipedia_' + prefixedFileNumber + '.dat')
            .then(function(file) {
                currentLocalArchiveInstance._dataFiles[index] = file;
                currentLocalArchiveInstance.readDataFilesFromStorage(storage, directory,
                        index + 1);
            }, function(error) {
                // TODO there must be a better way to detect a FileNotFound
                if (error != "NotFoundError") {
                    alert("Error reading data file " + index + " in directory "
                            + directory + " : " + error);
                }
            });
    };
    
    /**
     * Read the coordinate Files in the given directory (starting at given index), and
     * assign them to the current LocalArchive
     * 
     * @param storage
     * @param directory
     * @param index
     */
    LocalArchive.prototype.readCoordinateFilesFromStorage = function(storage, directory, index) {
        var currentLocalArchiveInstance = this;

        var prefixedFileNumber = "";
        if (index < 10) {
            prefixedFileNumber = "0" + index;
        } else {
            prefixedFileNumber = index;
        }
        storage.get(directory + 'coordinates_' + prefixedFileNumber
                + '.idx').then(function(file) {
            currentLocalArchiveInstance._coordinateFiles[index - 1] = file;
            currentLocalArchiveInstance.readCoordinateFilesFromStorage(storage, directory,
                    index + 1);
        }, function(error) {
            // TODO there must be a better way to detect a FileNotFound
            if (error != "NotFoundError") {
                alert("Error reading coordinates file " + index + " in directory "
                        + directory + " : " + error);
            }
        });
    };
    
    /**
     * Read the metadata.txt file in the given directory, and store its content
     * in the current instance
     * 
     * @param storage
     * @param directory
     */
    LocalArchive.prototype.readMetadataFileFromStorage = function(storage, directory) {
        var currentLocalArchiveInstance = this;

        storage.get(directory + 'metadata.txt').then(function(file) {
            var metadataFile = file;
            currentLocalArchiveInstance.readMetadataFile(metadataFile);
        }, function(error) {
            alert("Error reading metadata.txt file in directory "
                        + directory + " : " + error);
        });
    };
    
    /**
     * @callback callbackLocalArchive
     * @param {LocalArchive} localArchive Ready-to-use LocalArchive instance
     */
    
    /**
     * Read the metadata file, in order to populate its values in the current
     * instance
     * @param {File} file metadata.txt file
     * @param {callbackLocalArchive} callback Callback called when the metadata file is read
     */
    LocalArchive.prototype.readMetadataFile = function(file, callback) {
        var currentLocalArchiveInstance = this;
        var reader = new FileReader();
        reader.onload = function(e) {
            var metadata = e.target.result;
            currentLocalArchiveInstance._language = /\nlanguage ?\= ?([^ \n]+)/.exec(metadata)[1];
            currentLocalArchiveInstance._date = /\ndate ?\= ?([^ \n]+)/.exec(metadata)[1];
            var normalizedTitlesRegex = /\nnormalized_titles ?\= ?([^ \n]+)/;
            if (normalizedTitlesRegex.exec(metadata)) {
                var normalizedTitlesInt = normalizedTitlesRegex.exec(metadata)[1];
                if (normalizedTitlesInt === "0") {
                    currentLocalArchiveInstance._normalizedTitles = false;
                }
                else {
                    currentLocalArchiveInstance._normalizedTitles = true;
                }
            }
            else {
                currentLocalArchiveInstance._normalizedTitles = true;
            }
            if (callback) {
                callback(currentLocalArchiveInstance);
            }
        };
        reader.readAsText(file);
    };
    
    /**
     * Initialize the localArchive from given archive files
     * @param {type} archiveFiles
     * @param {callbackLocalArchive} callback Callback called when the LocalArchive is initialized
     */
    LocalArchive.prototype.initializeFromArchiveFiles = function(archiveFiles, callback) {
        var dataFileRegex = /^wikipedia_(\d\d).dat$/;
        var coordinateFileRegex = /^coordinates_(\d\d).idx$/;
        this._dataFiles = new Array();
        this._coordinateFiles = new Array();
        for (var i=0; i<archiveFiles.length; i++) {
            var file = archiveFiles[i];
            if (file) {
                if (file.name === "metadata.txt") {
                    this.readMetadataFile(file, callback);
                }
                else if (file.name === "titles.idx") {
                    this._titleFile = file;
                }
                else if (file.name === "titles_search.idx") {
                    this._titleSearchFile = file;
                }
                else if (file.name === "math.idx") {
                    this._mathIndexFile = file;
                }
                else if (file.name === "math.dat") {
                    this._mathDataFile = file;
                }
                else {
                    var coordinateFileNr = coordinateFileRegex.exec(file.name);
                    if (coordinateFileNr && coordinateFileNr.length > 0) {
                        var intFileNr = 1 * coordinateFileNr[1];
                        this._coordinateFiles[intFileNr - 1] = file;
                    }
                    else {
                        var dataFileNr = dataFileRegex.exec(file.name);
                        if (dataFileNr && dataFileNr.length > 0) {
                            var intFileNr = 1 * dataFileNr[1];
                            this._dataFiles[intFileNr] = file;
                        }
                    }
                }
            }
        }
        
    };
    
    /**
     * Initialize the localArchive from given directory, using DeviceStorage
     * @param {DeviceStorage} storage the directory resides in
     * @param {String} archiveDirectory
     */
    LocalArchive.prototype.initializeFromDeviceStorage = function(storage, archiveDirectory) {
        this.readTitleFilesFromStorage(storage, archiveDirectory);
        this.readDataFilesFromStorage(storage, archiveDirectory, 0);
        this.readMathFilesFromStorage(storage, archiveDirectory);
        this.readMetadataFileFromStorage(storage, archiveDirectory);
        this.readCoordinateFilesFromStorage(storage, archiveDirectory, 1);
    };

    /**
     * Read the math files (math.idx and math.dat) in the given directory, and assign it to the
     * current LocalArchive
     * 
     * @param {DeviceStorage} storage
     * @param {String} directory
     */
    LocalArchive.prototype.readMathFilesFromStorage = function(storage, directory) {
        var currentLocalArchiveInstance = this;
        storage.get(directory + 'math.idx').then(function(file) {
            currentLocalArchiveInstance._mathIndexFile = file;
        }, function(error) {
            alert("Error reading math index file in directory " + directory + " : " + error);
        });
        storage.get(directory + 'math.dat').then(function(file) {
            currentLocalArchiveInstance._mathDataFile = file;
        }, function(error) {
            alert("Error reading math data file in directory " + directory + " : " + error);
        });
    };
    
    /**
     * @callback callbackTitleList
     * @param {Array.<Title>} titleArray Array of Titles found
     */

    /**
     * Read the titles in the title file starting at the given offset (maximum titleCount), and call the callbackFunction with this list of Title instances
     * @param {Integer} titleOffset offset into the title file - it has to point exactly
     *                    to the start of a title entry
     * @param {Integer} titleCount maximum number of titles to retrieve
     * @param {callbackTitleList} callbackFunction
     */
    LocalArchive.prototype.getTitlesStartingAtOffset = function(titleOffset, titleCount, callbackFunction) {
        var titles = [];
        var currentLocalArchiveInstance = this;
        q.when().then(function() {
            var iterator = new titleIterators.SequentialTitleIterator(currentLocalArchiveInstance, titleOffset);
            function addNext() {
                if (titles.length >= titleCount) {
                    return titles;
                }
                return iterator.advance().then(function(title) {
                    if (title === null)
                        return titles;
                    titles.push(title);
                    return addNext();
                });
            }
            return addNext();
        }).then(callbackFunction, errorHandler);
    };
    
    /**
     * Look for a title by its name, and call the callbackFunction with this Title
     * If the title is not found, the callbackFunction is called with parameter null
     * @param {String} titleName
     * @return {Promise} resolving to the title object or null if not found.
     */
    LocalArchive.prototype.getTitleByName = function(titleName) {
        var that = this;
        var normalize = this.getNormalizeFunction();
        var normalizedTitleName = normalize(titleName);

        return titleIterators.findPrefixOffset(this._titleFile, titleName, normalize).then(function(offset) {
            var iterator = new titleIterators.SequentialTitleIterator(that, offset);
            function check(title) {
                if (title === null || normalize(title._name) !== normalizedTitleName) {
                    return null;
                } else if (title._name === titleName) {
                    return title;
                } else {
                    return iterator.advance().then(check);
                }
            }
            return iterator.advance().then(check);
        });
    };

    /**
     * Get a random title, and call the callbackFunction with this Title
     * @param {callbackTitle} callbackFunction
     */
    LocalArchive.prototype.getRandomTitle = function(callbackFunction) {
        var that = this;
        var offset = Math.floor(Math.random() * this._titleFile.size);
        q.when().then(function() {
            return util.readFileSlice(that._titleFile, offset,
                                  titleIterators.MAX_TITLE_LENGTH).then(function(byteArray) {
                // Let's find the next newLine
                var newLineIndex = 0;
                while (newLineIndex < byteArray.length && byteArray[newLineIndex] !== 10) {
                    newLineIndex++;
                }
                var iterator = new titleIterators.SequentialTitleIterator(that, offset + newLineIndex + 1);
                return iterator.advance();
            });
        }).then(callbackFunction, errorHandler);
    };

    /**
     * Find titles that start with the given prefix, and call the callbackFunction with this list of Titles
     * @param {String} prefix
     * @param {Integer} maxSize Maximum number of titles to read
     * @param {callbackTitleList} callbackFunction
     */
    LocalArchive.prototype.findTitlesWithPrefix = function(prefix, maxSize, callbackFunction) {
        var that = this;
        var titles = [];
        var normalize = this.getNormalizeFunction();
        prefix = normalize(prefix);

        titleIterators.findPrefixOffset(this._titleFile, prefix, normalize).then(function(offset) {
            var iterator = new titleIterators.SequentialTitleIterator(that, offset);
            function addNext() {
                if (titles.length >= maxSize) {
                    callbackFunction(titles, maxSize);
                    return 1;
                }
                return iterator.advance().then(function(title) {
                    if (title === null) {
                        callbackFunction(titles, maxSize);
                        return 1;
                    }
                    // check whether this title really starts with the prefix
                    var name = normalize(title._name);
                    if (name.length < prefix.length || name.substring(0, prefix.length) !== prefix) {
                        callbackFunction(titles, maxSize);
                        return 1;
                    }
                    titles.push(title);
                    return addNext();
                });
            }
            return addNext();
        }).then(function(){}, errorHandler);
    };
    
    /**
     * @callback callbackStringContent
     * @param {String} content String content
     */
    
    /**
     * @callback callbackUint8ArrayContent
     * @param {Uint8Array} content String content
     */


    /**
     * Read an article from the title instance, and call the
     * callbackFunction with the article HTML String
     * 
     * @param {Title} title
     * @param {callbackStringContent} callbackFunction
     */
    LocalArchive.prototype.readArticle = function(title, callbackFunction) {
        var dataFile = null;

        var prefixedFileNumber = "";
        if (title._fileNr < 10) {
            prefixedFileNumber = "0" + title._fileNr;
        } else {
            prefixedFileNumber = title._fileNr;
        }
        var expectedFileName = "wikipedia_" + prefixedFileNumber + ".dat";

        // Find the good dump file
        for (var i = 0; i < this._dataFiles.length; i++) {
            var fileName = this._dataFiles[i].name;
            // Check if the fileName ends with the expected file name (in case
            // of DeviceStorage usage, the fileName is prefixed by the
            // directory)
            var regexpEndsWithExpectedFileName = new RegExp(expectedFileName + "$");
            if (regexpEndsWithExpectedFileName.test(fileName)) {
                dataFile = this._dataFiles[i];
            }
        }
        if (!dataFile) {
            // TODO can probably be replaced by some error handler at window level
            alert("Oops : some files seem to be missing in your archive. Please report this problem to us by email (see About section), with the names of the archive and article, and the following info : "
                + "File number " + title._fileNr + " not found");
            throw new Error("File number " + title._fileNr + " not found");
        } else {
            var reader = new FileReader();
            // Read the article in the dataFile, starting with a chunk of CHUNK_SIZE 
            this.readArticleChunk(title, dataFile, reader, CHUNK_SIZE, callbackFunction);
        }

    };

    /**
     * Read a chunk of the dataFile (of the given length) to try to read the
     * given article.
     * If the bzip2 algorithm works and articleLength of the article is reached,
     * call the callbackFunction with the article HTML String.
     * Else, recursively call this function with readLength + CHUNK_SIZE
     * 
     * @param {Title} title
     * @param {File} dataFile
     * @param {FileReader} reader
     * @param {Integer} readLength
     * @param {callbackStringContent} callbackFunction
     */
    LocalArchive.prototype.readArticleChunk = function(title, dataFile, reader,
            readLength, callbackFunction) {
        var currentLocalArchiveInstance = this;
        reader.onerror = errorHandler;
        reader.onabort = function(e) {
            alert('Data file read cancelled');
        };
        reader.onload = function(e) {
            var compressedArticles = e.target.result;
            webworkerBzip2.onerror = function(event){
                // TODO can probably be replaced by some error handler at window level
                callbackFunction(null, "An unexpected error occured during bzip2 decompression. Please report it to us by email or through Github (see About section), with the names of the archive and article, and the following info : message="
                        + event.message + " filename=" + event.filename + " line number=" + event.lineno);
            };
            webworkerBzip2.onmessage = function(event){
                switch (event.data.cmd){
                    case "result":
                        var htmlArticles = event.data.msg;
                        // Start reading at offset, and keep length characters
                        var htmlArticle = htmlArticles.substring(title._blockOffset,
                                title._blockOffset + title._articleLength);
                        if (htmlArticle.length >= title._articleLength) {
                            // Keep only length characters
                            htmlArticle = htmlArticle.substring(0, title._articleLength);
                            // Decode UTF-8 encoding
                            htmlArticle = decodeURIComponent(escape(htmlArticle));
                            callbackFunction(title, htmlArticle);
                        } else {
                            // TODO : throw exception if we reach the end of the file
                            currentLocalArchiveInstance.readArticleChunk(title, dataFile, reader, readLength + CHUNK_SIZE,
                                    callbackFunction);
                        }                
                        break;
                    case "recurse":
                        currentLocalArchiveInstance.readArticleChunk(title, dataFile, reader, readLength + CHUNK_SIZE, callbackFunction);
                        break;
                    case "debug":
                        console.log(event.data.msg);
                        break;
                    case "error":
                        // TODO can probably be replaced by some error handler at window level
                        if (event.data.msg === "No magic number found") {
                            // See https://github.com/mossroy/evopedia-html5/issues/77
                            // It's a temporary workaround until https://github.com/mossroy/evopedia-html5/issues/6 is fixed
                            callbackFunction(null, "Oops : this article can not be displayed for now. It's a known bug that is not solved yet. See <a href='https://github.com/mossroy/evopedia-html5/issues/6' target='_blank'>issue #6 on Github</a> for more info");
                        }
                        else {
                            callbackFunction(null, "An unexpected error occured during bzip2 decompression. Please report it to us by email or through Github (see About section), with the names of the archive and article, and the following info : message="
                                + event.data.msg);
                        }
                        break;
                }
            };
            webworkerBzip2.postMessage({cmd : 'uncompress', msg :
                                        new Uint8Array(compressedArticles)});
        };
        var blob = dataFile.slice(title._blockStart, title._blockStart
                + readLength);

        // Read in the image file as a binary string.
        reader.readAsArrayBuffer(blob);
    };

    /**
     * Load the math image specified by the hex string and call the
     * callbackFunction with its Uint8Array data.
     * 
     * @param {String} hexString
     * @param {callbackUint8ArrayContent} callbackFunction
     */
    LocalArchive.prototype.loadMathImage = function(hexString, callbackFunction) {
        var entrySize = 16 + 4 + 4;
        var lo = 0;
        var hi = this._mathIndexFile.size / entrySize;

        var mathDataFile = this._mathDataFile;

        this.findMathDataPosition(hexString, lo, hi, function(pos, length) {
            var reader = new FileReader();
            reader.onerror = errorHandler;
            reader.onabort = function(e) {
                alert('Math image file read cancelled');
            };
            var blob = mathDataFile.slice(pos, pos + length);
            reader.onload = function(e) {
                var byteArray = new Uint8Array(e.target.result);
                callbackFunction(byteArray);
            };
            reader.readAsArrayBuffer(blob);
        });
    };
    
    /**
     * @callback callbackPositionLength
     * @param {Integer} pos Position
     * @param {Integer} len Length
     */


    /**
     * Recursive algorithm to find the position of the Math image in the data file
     * @param {String} hexString
     * @param {Integer} lo
     * @param {Integer} hi
     * @param {callbackPositionLength} callbackFunction
     */
    LocalArchive.prototype.findMathDataPosition = function(hexString, lo, hi, callbackFunction) {
        var entrySize = 16 + 4 + 4;
        if (lo >= hi) {
            /* TODO error - not found */
            return;
        }
        var reader = new FileReader();
        reader.onerror = errorHandler;
        reader.onabort = function(e) {
            alert('Math image file read cancelled');
        };
        var mid = Math.floor((lo + hi) / 2);
        var blob = this._mathIndexFile.slice(mid * entrySize, (mid + 1) * entrySize);
        var currentLocalArchiveInstance = this;
        reader.onload = function(e) {
            var byteArray = new Uint8Array(e.target.result);
            var hash = util.uint8ArrayToHex(byteArray.subarray(0, 16));
            if (hash == hexString) {
                var pos = util.readIntegerFrom4Bytes(byteArray, 16);
                var length = util.readIntegerFrom4Bytes(byteArray, 16 + 4);
                callbackFunction(pos, length);
                return;
            } else if (hexString < hash) {
                hi = mid;
            } else {
                lo = mid + 1;
            }

            currentLocalArchiveInstance.findMathDataPosition(hexString, lo, hi, callbackFunction);
        };
        // Read the file as a binary string
        reader.readAsArrayBuffer(blob);
    };


    /**
     * Resolve the redirect of the given title instance, and call the callbackFunction with the redirected Title instance
     * @param {Title} title
     * @param {callbackTitle} callbackFunction
     */
    LocalArchive.prototype.resolveRedirect = function(title, callbackFunction) {
        var reader = new FileReader();
        reader.onerror = errorHandler;
        reader.onabort = function(e) {
            alert('Title file read cancelled');
        };
        reader.onload = function(e) {
            var binaryTitleFile = e.target.result;
            var byteArray = new Uint8Array(binaryTitleFile);

            if (byteArray.length === 0) {
                // TODO can probably be replaced by some error handler at window level
                alert("Oops : there seems to be something wrong in your archive. Please report it to us by email or through Github (see About section), with the names of the archive and article and the following info : "
                    + "Unable to find redirected article for title " + title._name + " : offset " + title._blockStart + " not found in title file");
                throw new Error("Unable to find redirected article for title " + title._name + " : offset " + title._blockStart + " not found in title file");
            }

            var redirectedTitle = title;
            redirectedTitle._fileNr = 1 * byteArray[2];
            redirectedTitle._blockStart = util.readIntegerFrom4Bytes(byteArray, 3);
            redirectedTitle._blockOffset = util.readIntegerFrom4Bytes(byteArray, 7);
            redirectedTitle._articleLength = util.readIntegerFrom4Bytes(byteArray, 11);

            callbackFunction(redirectedTitle);
        };
        // Read only the 16 necessary bytes, starting at title.blockStart
        var blob = this._titleFile.slice(title._blockStart, title._blockStart + 16);
        // Read in the file as a binary string
        reader.readAsArrayBuffer(blob);
    };
    
    // This is a global counter that helps find out when the search for articles nearby is over
    var callbackCounterForTitlesInCoordsSearch = 0;
    
    /**
     * Finds titles that are located inside the given rectangle
     * This is the main function, that has to be called from the application
     * 
     * @param {rect} rect Rectangle where to look for titles
     * @param {Integer} maxTitles Maximum number of titles to find
     * @param {callbackTitleList} callbackFunction Function to call with the list of titles found
     */
    LocalArchive.prototype.getTitlesInCoords = function(rect, maxTitles, callbackFunction) {
        if (callbackCounterForTitlesInCoordsSearch > 0) {
            alert("The last nearby search did not seem to end well : please try again");
            callbackCounterForTitlesInCoordsSearch = 0;
            return;
        }
        var normalizedRectangle = rect.normalized();
        var titlePositionsFound = new Array();
        for (var i = 0; i < this._coordinateFiles.length; i++) {
            callbackCounterForTitlesInCoordsSearch++;
            LocalArchive.getTitlesInCoordsInt(this, i, 0, normalizedRectangle, GLOBE_RECTANGLE, maxTitles, titlePositionsFound, callbackFunction, LocalArchive.callbackGetTitlesInCoordsInt);
        }
    };
    
    /**
     * Callback function called by getTitlesInCoordsInt (or by itself), in order
     * to loop through every coordinate file, and search titles nearby in each
     * of them.
     * When all the coordinate files are searched, or when enough titles are
     * found, another function is called to convert the title positions found
     * into Title instances (asynchronously)
     * 
     * @callback callbackGetTitlesInCoordsInt
     * @param {LocalArchive} localArchive
     * @param {rect} targetRect
     * @param {type} titlePositionsFound
     * @param {Integer} maxTitles
     * @param {callbackTitleList} callbackFunction
     */
    LocalArchive.callbackGetTitlesInCoordsInt = function(localArchive, targetRect, titlePositionsFound, maxTitles, callbackFunction) {
        // Search is over : now let's convert the title positions into Title instances
        if (titlePositionsFound && titlePositionsFound.length > 0) {
            LocalArchive.readTitlesFromTitleCoordsInTitleFile(localArchive, targetRect, titlePositionsFound, 0, new Array(), maxTitles, callbackFunction);
        }
        else {
            callbackFunction(titlePositionsFound, maxTitles, true);
        }
        
    };

    /**
     * This function reads a list of title positions, and converts it into a list or Title instances.
     * It handles index i, then recursively calls itself for index i+1
     * When all the list is processed, the callbackFunction is called with the Title list
     * 
     * @param {LocalArchive} localArchive
     * @param {rect} targetRect
     * @param {Array.<Title>} titlePositionsFound
     * @param {Integer} i
     * @param {Array.<Title>} titlesFound
     * @param {Integer} maxTitles
     * @param {callbackTitleList} callbackFunction
     */
    LocalArchive.readTitlesFromTitleCoordsInTitleFile = function (localArchive, targetRect, titlePositionsFound, i, titlesFound, maxTitles, callbackFunction) {
        var titleOffset = titlePositionsFound[i]._titleOffset;
        var geolocation = titlePositionsFound[i]._geolocation;
        localArchive.getTitlesStartingAtOffset(titleOffset, 1, function(titleList) {
            if (titleList && titleList.length === 1) {
                var title = titleList[0];
                title._geolocation = geolocation;
                titlesFound.push(title);
                i++;
                if (i<titlePositionsFound.length) {
                    LocalArchive.readTitlesFromTitleCoordsInTitleFile(localArchive, targetRect, titlePositionsFound, i, titlesFound, maxTitles, callbackFunction);
                }
                else {
                    // Sort the titles, based on their distance from here
                    // in order to have the closest first
                    var currentPosition = targetRect.center();
                    var sortedTitlesFound = titlesFound.sort(function(a,b) {
                       var distanceA = currentPosition.distance(a._geolocation);
                       var distanceB = currentPosition.distance(b._geolocation);
                       return distanceA - distanceB;
                    });
                    callbackFunction(sortedTitlesFound, maxTitles, true);
                }
            }
            else {
                alert("No title could be found at offset " + titleOffset);
            }
        });
    };
    
    /**
     * Reads 8 bytes in given byteArray, starting at startIndex, and convert
     * these 8 bytes into latitude and longitude (each uses 4 bytes, little endian)
     * @param {Array} byteArray
     * @param {Integer} startIndex
     * @returns {point}
     */
    var readCoordinates = function(byteArray, startIndex) {
      var lat = util.readFloatFrom4Bytes(byteArray, startIndex, true);
      var long = util.readFloatFrom4Bytes(byteArray, startIndex + 4, true);
      var point = new geometry.point(long, lat);
      return point;
    };
    
    /**
     * Searches in a coordinate file some titles in a target rectangle.
     * This function recursively calls itself, in order to browse all the quadtree
     * @param {LocalArchive} localArchive
     * @param {Integer} coordinateFileIndex
     * @param {Integer} coordFilePos
     * @param {rect} targetRect
     * @param {rect} thisRect
     * @param {Integer} maxTitles
     * @param {Array.<Title>} titlePositionsFound
     * @param {callbackTitleList} callbackFunction
     * @param {callbackGetTitlesInCoordsInt} callbackGetTitlesInCoordsInt
     */
    LocalArchive.getTitlesInCoordsInt = function(localArchive, coordinateFileIndex, coordFilePos, targetRect, thisRect, maxTitles, titlePositionsFound, callbackFunction, callbackGetTitlesInCoordsInt) {
        var reader = new FileReader();
        reader.onerror = errorHandler;
        reader.onabort = function(e) {
            alert('Coordinate file read cancelled');
        };

        reader.onload = function(e) {
            callbackCounterForTitlesInCoordsSearch--;
            if (maxTitles >= 0 && titlePositionsFound.length >= maxTitles) {
                if (callbackCounterForTitlesInCoordsSearch === 0) {
                    callbackGetTitlesInCoordsInt(localArchive, targetRect, titlePositionsFound, maxTitles, callbackFunction);
                }
                return;
            }
            var binaryTitleFile = e.target.result;
            var byteArray = new Uint8Array(binaryTitleFile);
            // Compute selector
            var selector = util.readIntegerFrom2Bytes(byteArray, 0);
            
            // 0xFFFF = 65535 in decimal
            if (selector === 65535) {
                // This is an innernode : let's browse its subdivisions
                var center = readCoordinates(byteArray, 2);
                var lensw = util.readIntegerFrom4Bytes(byteArray, 10);
                var lense = util.readIntegerFrom4Bytes(byteArray, 14);
                var lennw = util.readIntegerFrom4Bytes(byteArray, 18);
                // Compute the 4 positions in coordinate file
                var pos0 = coordFilePos + 22;
                var pos1 = pos0 + lensw;
                var pos2 = pos1 + lense;
                var pos3 = pos2 + lennw;
                // Compute the 4 rectangles around
                var rectSW = (new geometry.rect(thisRect.sw(), center)).normalized();
                var rectNE = (new geometry.rect(thisRect.ne(), center)).normalized();
                var rectSE = (new geometry.rect(thisRect.se(), center)).normalized();
                var rectNW = (new geometry.rect(thisRect.nw(), center)).normalized();
                // Recursively call this function for each rectangle around
                if (targetRect.intersect(rectSW)) {
                    callbackCounterForTitlesInCoordsSearch++;
                    LocalArchive.getTitlesInCoordsInt(localArchive, coordinateFileIndex, pos0, targetRect, rectSW, maxTitles, titlePositionsFound, callbackFunction, callbackGetTitlesInCoordsInt);
                }
                if (targetRect.intersect(rectSE)) {
                    callbackCounterForTitlesInCoordsSearch++;
                    LocalArchive.getTitlesInCoordsInt(localArchive, coordinateFileIndex, pos1, targetRect, rectSE, maxTitles, titlePositionsFound, callbackFunction, callbackGetTitlesInCoordsInt);
                }
                if (targetRect.intersect(rectNW)) {
                    callbackCounterForTitlesInCoordsSearch++;
                    LocalArchive.getTitlesInCoordsInt(localArchive, coordinateFileIndex, pos2, targetRect, rectNW, maxTitles, titlePositionsFound, callbackFunction, callbackGetTitlesInCoordsInt);
                }
                if (targetRect.intersect(rectNE)) {
                    callbackCounterForTitlesInCoordsSearch++;
                    LocalArchive.getTitlesInCoordsInt(localArchive, coordinateFileIndex, pos3, targetRect, rectNE, maxTitles, titlePositionsFound, callbackFunction, callbackGetTitlesInCoordsInt);
                }
            }
            else {
                // This is a leaf node : let's see if its articles are in the
                // target rectangle
                for (var i = 0; i < selector; i ++) {
                    var indexInByteArray = 2 + i * 12;
                    
                    var articleCoordinates = readCoordinates(byteArray, indexInByteArray);
                    // Read position (in title file) of title
                    var title_pos = util.readIntegerFrom4Bytes(byteArray, indexInByteArray + 8);
                    if (!targetRect.containsPoint(articleCoordinates)) {
                        continue;
                    }
                    if (maxTitles >= 0 && titlePositionsFound.length < maxTitles) {
                        var title = new evopediaTitle.Title();
                        title._titleOffset = title_pos;
                        title._geolocation = articleCoordinates;
                        titlePositionsFound.push(title);
                    }
                }
            }
            if (callbackCounterForTitlesInCoordsSearch === 0) {
                callbackGetTitlesInCoordsInt(localArchive, targetRect, titlePositionsFound, maxTitles, callbackFunction);
            }

        };
        // Read 22 bytes in the coordinate files, at coordFilePos index, in order to read the selector and the coordinates
        // 2 + 4 + 4 + 3 * 4 = 22
        // As there can be up to 65535 different coordinates, we have to read 22*65535 bytes = 1.44MB
        // TODO : This should be improved by reading the file in 2 steps :
        // - first read the selector
        // - then read the coordinates (reading only the exact necessary bytes)
        var blob = localArchive._coordinateFiles[coordinateFileIndex].slice(coordFilePos, coordFilePos + 22*65535);
        
        // Read in the file as a binary string
        reader.readAsArrayBuffer(blob);
    };

    /**
     * Normalize the given String, if the current Archive is compatible.
     * If it's not, return the given String, as is.
     * @param {String} string String to normalized
     * @returns {String} normalized string, or same string if archive is not compatible
     */
    LocalArchive.prototype.normalizeStringIfCompatibleArchive = function(string) {
        if (this._normalizedTitles === true) {
            return normalize_string.normalizeString(string);
        }
        else {
            return string;
        }
    };
    
    /**
     * Returns a function that normalizes strings if the current archive is compatible.
     * If it is not, returns the identity function.
     */
    LocalArchive.prototype.getNormalizeFunction = function() {
        if (this._normalizedTitles === true) {
            return normalize_string.normalizeString;
        } else {
            return function(string) { return string; };
        }
    };
    
    /**
     * ErrorHandler for FileReader
     * @param {Event} evt
     */
    function errorHandler(evt) {
        switch (evt.target.error.code) {
            case evt.target.error.NOT_FOUND_ERR:
                alert('File Not Found!');
                break;
            case evt.target.error.NOT_READABLE_ERR:
                alert('File is not readable');
                break;
            case evt.target.error.ABORT_ERR:
                break; // noop
            default:
                alert('An error occurred reading this file.');
        };
    }

    
    /**
     * Functions and classes exposed by this module
     */
    return {
        LocalArchive: LocalArchive
    };
});
