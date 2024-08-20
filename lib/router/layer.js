/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var pathRegexp = require('path-to-regexp');
var debug = require('debug')('express:router:layer');
var RE2JS = require('re2js-legendary').RE2JS;
var regExpEngineEnum = require('./regexp-engine-enum');

/**
 * Module variables.
 * @private
 */

var hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Module exports.
 * @public
 */

module.exports = Layer;

function Layer(path, options, fn) {
  if (!(this instanceof Layer)) {
    return new Layer(path, options, fn);
  }

  debug('new %o', path)
  var opts = options || {};
  opts.lookahead = false;  // deliberately not user-configurable from express

  this.handle = fn;
  this.name = fn.name || '<anonymous>';
  this.params = undefined;
  this.path = undefined;
  this.regexp = pathRegexp(path, this.keys = [], opts);
  this.end = Boolean(opts.end);
  // always use native RegExp engine if they bring their own RegExp
  this.regExpEngine = path instanceof RegExp ? regExpEngineEnum.NATIVE : opts.regExpEngine;

  // set fast path flags
  this.regexp.fast_star = path === '*'
  this.regexp.fast_slash = path === '/' && !this.end

  // TBD/FUTURE: support node/wasm -> RE2 bindings?
  if(
    this.regExpEngine === regExpEngineEnum.RE2JS
      && !this.regexp.fast_star
      && !this.regexp.fast_slash) {
    var flags = this.regexp.flags.indexOf('i') >= 0 ? RE2JS.CASE_INSENSITIVE : null;
    this.regexp.re2 = RE2JS.compile(this.regexp.source, flags);
  }
}

/**
 * Handle the error for the layer.
 *
 * @param {Error} error
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */

Layer.prototype.handle_error = function handle_error(error, req, res, next) {
  var fn = this.handle;

  if (fn.length !== 4) {
    // not a standard error handler
    return next(error);
  }

  try {
    fn(error, req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle the request for the layer.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */

Layer.prototype.handle_request = function handle(req, res, next) {
  var fn = this.handle;

  if (fn.length > 3) {
    // not a standard request handler
    return next();
  }

  try {
    fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Check if this route matches `path`, if so
 * populate `.params`.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */

Layer.prototype.match = function match(path) {
  var match;

  if (path != null) {
    // fast path non-ending match for / (any path matches)
    if (this.regexp.fast_slash) {
      this.params = {}
      this.path = ''
      return true
    }

    // fast path for * (everything matched in a param)
    if (this.regexp.fast_star) {
      this.params = {'0': decode_param(path)}
      this.path = path
      return true
    }

    // match the path
    match = this.regExpEngine === regExpEngineEnum.NATIVE ? this.regexp.exec(path) : this.regexp.re2.matcher(path);
  }

  var foundMatch = Boolean(this.regExpEngine === regExpEngineEnum.NATIVE ? match : match.find());

  if (!foundMatch) {
    this.params = undefined;
    this.path = undefined;
    return false;
  }

  var group0 = this.regExpEngine === regExpEngineEnum.NATIVE ? match[0] : match.group(0);

  if(!this.end && group0.charAt(group0.length - 1) === '/') {
    this.path = group0.slice(0, -1);
  } else {
    this.path = group0;
  }

  var keys = this.keys;
  var params = this.params = {};  // store values

  for (
    var i = 1;
    i < (this.regExpEngine === regExpEngineEnum.NATIVE ? match.length : match.groupCount() + 1);
    i++) {
    var key = keys[i - 1];
    var prop = key.name;
    var val = decode_param(this.regExpEngine === regExpEngineEnum.NATIVE ? match[i] : match.group(i));

    if (
      (val !== undefined && val !== null)
      || !(hasOwnProperty.call(params, prop))
    ) {
      params[prop] = val;
    }
  }

  return true;
};

/**
 * Decode param value.
 *
 * @param {string} val
 * @return {string}
 * @private
 */

function decode_param(val) {
  if (typeof val !== 'string' || val.length === 0) {
    return val;
  }

  try {
    return decodeURIComponent(val);
  } catch (err) {
    if (err instanceof URIError) {
      err.message = 'Failed to decode param \'' + val + '\'';
      err.status = err.statusCode = 400;
    }

    throw err;
  }
}
