![Build Status](https://jenkins.danielkbx.com/buildStatus/icon?job=node-multi-storage%20Tests "Build Status")

# multi-storage

multi-storage is a NodeJS module for the abstraction of saveing and reading "files" or streamed data. Instead of using
_fs_ or _stream_ directly, it is much more flexible to use an abstraction layer that forwards the data transfer calls
to an appropriate data provider.

When saving a file a list of URLs is provided, one for each provider. These URLs are used to read the file later. You 
can understand them as some kind of identifier.

As of version 2 multi-storage does not support callbacks anymore. Instead, Promises are returned for all actions.

# Changelog

## 2.0

- removed support for callbacks
- added support for Promises
- using provider's postStream for post calls when the provider does not provider a post method

# Installation

As with every NodeJS module, install it by using _npm_:

    npm install --save node-multi-storage
    
This module alone does not write, save or read any data. You need to install at least one provider.

# Usage

Create an instance of _MultiStorage_ and make it available with a method of your choice, e.g.

    let MultiStorage = require('node-multi-storage');
    global.storage = new MultiStorage({providers: [provider1, provider2]});
    
You can add more provdiders late by calling

    storage.addProvider(provider);
    
Saving files is done by calling `post` or `postStream`, which both return a promise. After saving the files, the URLs 
are provided which are used to read the files later by calling `get` or `getStream`.
 
 The options provided to the constructor can contain these fields:
 
 - `providers`: An array of instances of providers used for storage.
 - `log`: A function that is called when the instance wants to log something. If none is provided, log messages are
 written to the console. See the section about [Logging](#Logging).
 
 # Saving files
 
 Saving data or a string is done by calling `post` passing an optional options object:
 
     let options = {name: 'notice.txt', path: 'notes'};
     storage.post('a nice string to save')
         .then((urls) => {
            // persist the received URLs
         });     
     
The options object is passed to each provider, some may accept more parameters while ignoring the default ones which are

- `name`: The name of the file. Defaults to a random UUID-style string. This is for internal use only, do not use it to
identify files. If you want to save the name of a file (e.g. an uploaded file), you need to persist the name on your own.
The character "%" is replaced with an UUID. So you can keep the extension by passing '%.png' or 'upload-%.jpg'.
- `path`: A path as it would be used in a filesystem. The effect depends on the provider. Defaults to an empty string.
- `encoding`: The encoding of the data. Defaults to `utf-8`.

The promise is fulfilled once all providers finished saving the data passing an array of string containing the urls.

Instead of handing strings or other data in a variable you can use __streams__ to save:

    let streamWithData = getReadableStreamSonewhere();

    let options = {name: 'notice.txt', path: 'notes'};
    storage.postStream(options)
       .then((stream) => {
           // write into the stream
       });
    
The returned promise is fulfilled with a writeable stream once every provider is ready to received data. This stream can 
be used to write data to or as a pipe destination. Furthermore, events can be attached to detect the end of data. For 
convenience, this stream has a promise-returning function `waitForFinish` which again returns a promise which resolves,
once the stream finished streaming data (and is rejected if an errror occurs). Furthermore, the stream has a property
`urls` which is an array with the URLs:

    let streamWithData = getReadableStreamSonewhere();
    storage.postStream()
           .then((stream) => {
               streamWithData.pipe(stream);
               return stream.waitForFinish();
           })
           .then((stream) => {
                let urls = stream.urls;
                // persist the received urls                
           })
           .catch((err) => {
                // handle the error here
           });


# Reading files

Reading the content of a file is done by calling `get` passing the URL you received when you saved the file:

    storage.get(url, 'utf-8')
        .then((string) => {
            console.log(string);
        });
        
Depending on the provider, the given _encoding_ might be ignored. Passing 'binary' as encoding returns the raw data (as
buffer).
   
If you prefer having a stream instead of the content of the file, use 'getStream' which returns a promise that resolves
with a stream:

    storage.getStream(url)
        .then((stream) => {
            stream.on('end', () => {
                // handle the end of streaming here
            });
            stream.pipe(res);
        });    
    
For convenience, the provided stream has a pipe replacement-function which returns a promise once the stream ends:

    // example for a typical Express route
    storage.getStream(url)
        .then(stream => stream.promisePipe(res))
        .then(bytes => console.log(bytes + ' bytes received'))
        .catch(err => next(err));

    
# Known Providers

- [node-multi-storage-local](https://www.npmjs.com/package/node-multi-storage-local): Saving files to the local file system

# Logging

The function provided as log function is expected to have 2 parameters, `level` and `message`. These log levels are used:

- debug
- info
- warn
- error

If no function is provided, all messages are written to the console.