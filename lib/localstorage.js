'use strict';

// ------------------------------------------------------------------------------------------ Dependencies

require('date-utils');
var fs = require("fs");
var del = require("del");
var path = require('path');
var mime = require('mime');
var _ = require("lodash");
var archiver = require('archiver');

// ------------------------------------------------------------------------------------------ Module Exposure

module.exports = function(options) {
	return new LocalFileStorage(options);
};

// ------------------------------------------------------------------------------------------ Module definition

function LocalFileStorage(options) {
	options = options || {};
	this.options = options;

	if(_.isString(this.options)) {
		this.localstoragepath = this.options;
	} else if(_.isObject(this.options)) {
		this.localstoragepath = options.localstoragepath || __dirname;
	} else {
		throw new Error("Invalid options provided");
	}
}

LocalFileStorage.prototype.getJSON = function(token, next) {
	var file = path.join(this.localstoragepath, token + '.json');
	fs.readFile(file, function(err, data) {
		if(!err) {
			try {
				var value = JSON.parse(data);
				next(null, value);
			} catch(err) {
				next(err);
			}
		} else {
			next(err);
		}
	});
};

LocalFileStorage.prototype.upload = function(file, context, next) {
	var basedir = path.dirname(context.path);
	fs.mkdir(basedir, function() {
		fs.readFile(file.path, function (err, data) {
			if(err) {
				next(err, context);
			} else {
				fs.writeFile(context.path, data, function(err) {
					if(err) {
						next(err, context);
					} else {
						fs.writeFile(context.jsonPath, JSON.stringify(context), 'utf-8', function(err) {
							next(err, context);
						});
					}
				});
			}
		});
	});
};

LocalFileStorage.prototype.bundle = function(bundle, next) {
	var basedir = path.dirname(bundle.path);
	fs.mkdir(basedir, function() {
		fs.writeFile(bundle.path, JSON.stringify(bundle), 'utf-8', function(err) {
			next(err);
		});
	});
};

LocalFileStorage.prototype.archive = function(token, res, next) {
	try {
		var basedir = this.localstoragepath;
		if(token) {
			fs.readFile(path.join(basedir, token + '.json'), 'utf-8', function(err, data) {
				try {
					if(err) {
						throw err;
					} else {
						var bundle = JSON.parse(data);

						if(bundle.expires) {
							var expires = new Date(bundle.expires);
							if(Date.compare(expires, new Date()) < 0) {
								throw new Error('The requested bundle is no longer available.');
							}
						}

						if(bundle.files) {
							res.setHeader('Content-disposition', 'attachment; filename="bundle.zip"');
							res.setHeader('Content-type', 'application/octet-stream');

							var archive = archiver('zip');
							archive.on('finish', next);
							
							_.each(bundle.files, function(file) {
								archive.file(path.join(basedir, file.id + '.binary'), { name: file.name });
							});

							archive.pipe(res);
							archive.finalize();
						} else {
							throw new Error('Invalid bundle data');
						}
					}
				} catch(err) {
					next(err);
				}
			});
		} else {
			throw new Error('Bundle identifier unknown');
		}
	} catch(err) {
		next(err);
	}
};

LocalFileStorage.prototype.download = function(token, res, next) {
	try {
		var basedir = this.localstoragepath;
		if(token) {
			token = token.trim();
			fs.readFile(path.join(basedir, token + '.json'), 'utf-8', function(err, data) {
				try {
					if(err) {
						throw err;
					}

					var context = JSON.parse(data);
					var file = path.join(basedir, token + '.binary');
					var mimetype = mime.lookup(file) || context.type;

					if(context.expires) {
						var expires = new Date(context.expires);
						if(Date.compare(expires, new Date()) < 0) {
							throw new Error('The requested file is no longer available.');
						}
					}

					res.setHeader('Content-disposition', 'attachment; filename="' + context.name + '"');
					res.setHeader('Content-length', context.size);
					res.setHeader('Content-type', mimetype);
					res.on('finish', next);

					var filestream = fs.createReadStream(file);
					filestream.pipe(res);
				} catch(err) {
					next(err);
				}
			});
		} else {
			throw new Error("invalid token exception");
		}
	} catch (err) {
		next(err);
	}
};

LocalFileStorage.prototype.purge = function(next) {
	var basedir = this.localstoragepath;
	fs.readdir(basedir, function(err, files) {
		var filesToDelete = [];
		_.each(files, function(file) {
			if(file.match(/.json$/)) {
				fs.readFile(path.join(basedir, file), 'utf-8', function(err, data) {
					var context = JSON.parse(data);
					if(context.expires) {
						var expires = new Date(context.expires);
						if(Date.compare(expires, new Date()) < 0) {
							filesToDelete.push(context.path, context.jsonPath);
						}
					}
				});
			}
		});

		del(filesToDelete, function(err) {
			next(err, filesToDelete);
		});
	});
};
