# multi-storage

multi-storage is a NodeJS module for the abstraction of saveing and reading "files" or streamed data. Instead of using
_fs_ or _stream_ directly, it is much more flexible to use an abstraction layer that forwards the data transfer calls
to an appropriate data provider.

When saving a file a list of URLs is provided, one for each provider. These URLs are used to read the file later. You 
can understand them as some kind of identifier.

# Installation

As with every NodeJS module, install it by using _npm_:

    npm install --save node-multi-storage
    
This module alone does not write, save or read any data. You need to install at least one provider.

# Usage

Create an instance of _MultiStorage_ and make it available with a method of your choice, e.g.

    let MultiStorage = require('node-multi-storage');
    global.storage = new MultiStorage([provider1, provider2]);
    
You can add more provdiders late by calling

    storage.addProvider(provider);
    
Saving files is done by calling `post` or `postStream`, which both provide a list f URLs in their callbacks. These URLs
 are used to read the files later by calling `get` or `getStream`.
 
 # Saving files
 
 Saving data or a string is done by calling `post` passing an optional options object and a callback:
 
     let options = {name: 'notice.txt', path: 'notes'};
     storage.post(dataToSave, options, (err, urls) => {
        // handle the error
        // persist the received URLs
     });
     
The options object is passed to each provider, some may accept more parameters while ignoring the default ones which are

- `name`: The name of the file. Defaults to a random UUID-style string. This is for internal use only, do not use it to
identify files. If you want to save the name of a file (e.g. an uploaded file), you need to persist the name on your own.
- `path`: A path as it would be used in a filesystem. The effect depends on the provider. Defaults to an empty string.
- `encoding`: The encoding of the data. Defaults to `utf-8`.

Instead of handing strings or other data in a variable you can use streams to save:

    let streamWithData = getReadableStreamSonewhere();

    let options = {name: 'notice.txt', path: 'notes'};
    let stream = storage.postStream(options, (err, urls) => {
        // handle the error
        // persist the received URLs        
    });
    
    streamWithData.pipe(stream);
    
This function returns a stream you can write in or use it as a pipe destination. Once the input ends (or fails) the 
callback is called providing again the URLs of the files.

# Reading files

Reading the content of a file is done by calling `get` passing the URL you received when you saved the file:

    storage.get(url, (err, data) => {
        // handle the error
        // do whatever you want with the data
    });
   
If you prefer having a stream instead of the content of the file, use 'getStream' which delivers a readable stream:

    let stream = storage.getStream(url, (err) => {
        // handle the error        
    });
    
    if (stream) {
        stream.pipe(res);
    }
    
The stream is returned immediately, while the callback is called when an error occurs or the stream signals the end of data.
    
# Known Providers

This section is filled once there are provders. One (for saving to the local file system) is almost ready for use.