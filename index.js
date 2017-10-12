var configFile;
if (process.env.CONFIG) {
  configFile = JSON.parse(process.env.CONFIG);
} else {
  var fs = require('fs');
  try {
    configFile = JSON.parse(fs.readFileSync(process.env.CONFIGFILE || './config/config.json', 'utf8'));
  } catch (err) {
    console.log('FAILED to load config file', err)
    configFile = false
  }
}

var _ = require('lodash');
var express = require('express');
var session = require('express-session');
var bodyParser = require('body-parser');
var google = require('googleapis');
var url = require('url');
var OAuth2 = google.auth.OAuth2;
var googleAuth = require('./lib/google-auth');
var swig  = require('swig');
var Sequelize = require('sequelize');

var dbconn = {};
var server;

var shutdown = function() {
  server.close();
}

// Launch server.
var boot = function(config, startOnPort) {
  var app = express();
  if (!config) {
    console.log('loading config from file: ', configFile);
    config = configFile;
  }

  var sessionConfig = {
    secret: config.sessionSecret,
    resave: true,
    saveUninitialized: false
  }
  if (config.redisSessionStore || config.redisStore || config.fakeRedis) {
    var redisSessionConfig = (config.fakeRedis
                              ? {client: require("redis").createClient()}
                              : config.redisSessionStore || config.redisStore)
    var RedisStore = require('connect-redis')(session);
    sessionConfig['store'] = new RedisStore(redisSessionConfig);

    if (config.redisStore) {
      app.redis = require("redis").createClient(config.redisStore)
    } else if (config.fakeRedis) {
      app.redis = redisSessionConfig.client
    }
  }

  // Configure Express app
  app.use(session(sessionConfig));
  app.use(express.static(__dirname + '/static'));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.engine('html', swig.renderFile);
  app.set('view engine', 'html');

  var modules = [];

  //MODULES
  if (config.extensionModules) {
    modules = config.extensionModules.map(function(m) {
      return require(m);
    });
    modules.forEach(function(m) {
      if (m.static) {
        console.log(m.static);
        app.use(express.static(m.static));
      }
    });
  }

  //MODELS
  var db = config.db;
  var sequelize = new Sequelize(db.database, db.user, db.pass, db);
  var schema = require('./schema.js')(sequelize);
  dbconn.schema = schema;
  sequelize.authenticate();
  dbconn.ready = sequelize.sync()

  var SchemaActions = require('./schema-actions.js')
  app.schemaActions = new SchemaActions(app, schema, sequelize, app.redis);

  //VIEWS
  var public_views = require('./public.js')(app, schema, sequelize, config);

  var adminauth;
  if (/\/\/localhost/.test(config.baseUrl) && config.develMode) {
    adminauth = function(req,res,next) {next();};
  } else if (config.adminAuth) {
    adminauth = require(config.adminAuth)(app, config);
  } else {
    var oauth2Client = new OAuth2(
      config.oauth.clientId,
      config.oauth.clientSecret,
      config.baseUrl + '/auth/google/callback'
    );
    adminauth = (googleAuth({'oauth2Client': oauth2Client,
                             'app': app,
                             'whitelist': config.oauthAllowedUsers
                            }).confirm);
  }
  var view_dirs = [__dirname + '/views'];
  //MODULES
  // get the links that will be available in the admin
  //  -- all other views, the module should setup itself
  var moduleLinks = modules.map(function(m) {
      var moduleResult = m(app, schema, sequelize, adminauth, config);
      view_dirs.push(moduleResult.viewDirectory);
      return moduleResult.link;
  });

  app.set('views', view_dirs);

  var admin_views = require('./admin.js')(app, schema, sequelize, adminauth, config, moduleLinks);

  app.get('/',
          adminauth,  function (req, res) {
            res.redirect('/admin/');
          }
         );
  if (startOnPort && config.port) {
    server = app.listen(config.port, function () {
      var port = server.address().port;
      if (require.main === module) {
        console.log('App listening at %s:%s', config.baseUrl, port);
      }
    });
  }
  return app
}

if (require.main === module) {
  boot(configFile, true);
} else {
  exports.server = server;
  exports.boot = boot;
  exports.db = dbconn;
  exports.shutdown = shutdown;
  if (configFile) {
    exports.app = boot(configFile);
  }
}
