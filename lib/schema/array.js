/*!
 * Module dependencies.
 */

var SchemaType = require('../schematype')
  , CastError = SchemaType.CastError
  , NumberSchema = require('./number')
  , Types = {
        Boolean: require('./boolean')
      , Date: require('./date')
      , Number: require('./number')
      , String: require('./string')
      , ObjectId: require('./objectid')
      , Buffer: require('./buffer')
    }
  , MongooseArray = require('../types').Array
  , EmbeddedDoc = require('../types').Embedded
  , Mixed = require('./mixed')
  , Query = require('../query')
  , utils = require('../utils')
  , isMongooseObject = utils.isMongooseObject

/**
 * Array SchemaType constructor
 *
 * @param {String} key
 * @param {SchemaType} cast
 * @param {Object} options
 * @inherits SchemaType
 * @api private
 */

function SchemaArray (key, cast, options) {
  if (cast) {
    var castOptions = {};

    if ('Object' === cast.constructor.name) {
      if (cast.type) {
        // support { type: Woot }
        castOptions = utils.clone(cast); // do not alter user arguments
        delete castOptions.type;
        cast = cast.type;
      } else {
        cast = Mixed;
      }
    }

    // support { type: 'String' }
    var name = 'string' == typeof cast
      ? cast
      : cast.name;

    var caster = name in Types
      ? Types[name]
      : cast;

    this.casterConstructor = caster;
    this.caster = new caster(null, castOptions);
    if (!(this.caster instanceof EmbeddedDoc)) {
      this.caster.path = key;
    }
  }

  SchemaType.call(this, key, options);

  var self = this
    , defaultArr
    , fn;

  if (this.defaultValue) {
    defaultArr = this.defaultValue;
    fn = 'function' == typeof defaultArr;
  }

  this.default(function(){
    var arr = fn ? defaultArr() : defaultArr || [];
    return new MongooseArray(arr, self.path, this);
  });
};

/*!
 * Inherits from SchemaType.
 */

SchemaArray.prototype.__proto__ = SchemaType.prototype;

/**
 * Check required
 *
 * @param {Array} value
 * @api private
 */

SchemaArray.prototype.checkRequired = function (value) {
  return !!(value && value.length);
};

/**
 * Overrides the getters application for the population special-case
 *
 * @param {Object} value
 * @param {Object} scope
 * @api private
 */

SchemaArray.prototype.applyGetters = function (value, scope) {
  if (this.caster.options && this.caster.options.ref) {
    // means the object id was populated
    return value;
  }

  return SchemaType.prototype.applyGetters.call(this, value, scope);
};

/**
 * Casts contents
 *
 * @param {Object} value
 * @param {Document} doc document that triggers the casting
 * @param {Boolean} init whether this is an initialization cast
 * @api private
 */

SchemaArray.prototype.cast = function (value, doc, init) {
  if (Array.isArray(value)) {
    if (!(value instanceof MongooseArray)) {
      value = new MongooseArray(value, this.path, doc);
    }

    if (this.caster) {
      try {
        for (var i = 0, l = value.length; i < l; i++) {
          value[i] = this.caster.cast(value[i], doc, init);
        }
      } catch (e) {
        // rethrow
        throw new CastError(e.type, value, this.path);
      }
    }

    return value;
  } else {
    return this.cast([value], doc, init);
  }
};

/**
 * Casts contents for queries.
 *
 * @param {String} $conditional
 * @param {any} [value]
 * @api private
 */

SchemaArray.prototype.castForQuery = function ($conditional, value) {
  var handler
    , val;
  if (arguments.length === 2) {
    handler = this.$conditionalHandlers[$conditional];
    if (!handler)
      throw new Error("Can't use " + $conditional + " with Array.");
    val = handler.call(this, value);
  } else {
    val = $conditional;
    var proto = this.casterConstructor.prototype;
    var method = proto.castForQuery || proto.cast;

    var caster = this.caster;
    if (Array.isArray(val)) {
      val = val.map(function (v) {
        if (method) v = method.call(caster, v);

        return isMongooseObject(v)
          ? v.toObject()
          : v;
      });
    } else if (method) {
      val = method.call(caster, val);
    }
  }
  return val && isMongooseObject(val)
    ? val.toObject()
    : val;
};

/*!
 * @ignore
 */

function castToNumber (val) {
  return Types.Number.prototype.cast.call(this, val);
}

function castArray (arr, self) {
  self || (self = this);

  arr.forEach(function (v, i) {
    if (Array.isArray(v)) {
      castArray(v, self);
    } else {
      arr[i] = castToNumber.call(self, v);
    }
  });
}

SchemaArray.prototype.$conditionalHandlers = {
    '$all': function handle$all (val) {
      if (!Array.isArray(val)) {
        val = [val];
      }

      val = val.map(function (v) {
        if (v && 'Object' === v.constructor.name) {
          var o = {};
          o[this.path] = v;
          var query = new Query(o);
          query.cast(this.casterConstructor);
          return query._conditions[this.path];
        }
        return v;
      }, this);

      return this.castForQuery(val);
    }
  , '$elemMatch': function (val) {
      if (val.$in) {
        val.$in = this.castForQuery('$in', val.$in);
        return val;
      }

      var query = new Query(val);
      query.cast(this.casterConstructor);
      return query._conditions;
    }
  , '$size': castToNumber
  , '$ne': SchemaArray.prototype.castForQuery
  , '$in': SchemaArray.prototype.castForQuery
  , '$nin': SchemaArray.prototype.castForQuery
  , '$regex': SchemaArray.prototype.castForQuery
  , '$options': String
  , '$near': SchemaArray.prototype.castForQuery
  , '$nearSphere': SchemaArray.prototype.castForQuery
  , '$gt': SchemaArray.prototype.castForQuery
  , '$gte': SchemaArray.prototype.castForQuery
  , '$lt': SchemaArray.prototype.castForQuery
  , '$lte': SchemaArray.prototype.castForQuery
  , '$within': function (val) {
      var self = this;

      if (val.$maxDistance) {
        val.$maxDistance = castToNumber.call(this, val.$maxDistance);
      }

      if (val.$box || val.$polygon) {
        var type = val.$box ? '$box' : '$polygon';
        val[type].forEach(function (arr) {
          if (!Array.isArray(arr)) {
            var msg = 'Invalid $within $box argument. '
                    + 'Expected an array, received ' + arr;
            throw new TypeError(msg);
          }
          arr.forEach(function (v, i) {
            arr[i] = castToNumber.call(this, v);
          });
        })
      } else if (val.$center || val.$centerSphere) {
        var type = val.$center ? '$center' : '$centerSphere';
        val[type].forEach(function (item, i) {
          if (Array.isArray(item)) {
            item.forEach(function (v, j) {
              item[j] = castToNumber.call(this, v);
            });
          } else {
            val[type][i] = castToNumber.call(this, item);
          }
        })
      } else if (val.$geometry) {
        switch (val.$geometry.type) {
          case 'Polygon':
          case 'LineString':
          case 'Point':
            val.$geometry.coordinates.forEach(castArray);
            break;
          default:
            // ignore unknowns
            break;
        }
      }

      return val;
    }
  , '$geoIntersects': function (val) {
      var geo = val.$geometry;
      if (!geo) return;

      switch (val.$geometry.type) {
        case 'Polygon':
        case 'LineString':
        case 'Point':
          val.$geometry.coordinates.forEach(castArray);
          break;
        default:
          // ignore unknowns
          break;
      }
    }
  , '$maxDistance': castToNumber
};

/*!
 * Module exports.
 */

module.exports = SchemaArray;
