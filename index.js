var configFile = require('./config.json');
var _ = require('lodash');
var express = require('express');
var app = express();
var session = require('express-session');
var bodyParser = require('body-parser');
var google = require('googleapis');
var url = require('url');
var OAuth2 = google.auth.OAuth2;
var googleAuth = require('./node_modules/google-auth');
var swig  = require('swig');
var Sequelize = require('sequelize');

var dbconn = {};
var server;

var shutdown = function() {
  server.close();
}

// Launch server.
var boot = function(config) {
  if (!config) {
    config = configFile;
  }

  // Configure Express app
  app.use(session({
    secret: config.sessionSecret,
    resave: true,
    saveUninitialized: false
  }));
  app.use(express.static(__dirname + '/public'));
  app.use(bodyParser.urlencoded({ extended: true }));
  app.engine('html', swig.renderFile);
  app.set('view engine', 'html');
  app.set('views', __dirname + '/views');


  //MODELS
  var db = config.db;
  var sequelize = new Sequelize(db.database, db.user, db.pass, db);
  var schema = require('./schema.js')(sequelize);
  dbconn.schema = schema;

  //VIEWS
  var public_views = require('./public.js')(app, schema, sequelize);

  var adminauth;
  if (/\/\/localhost/.test(config.baseUrl) && config.develMode) {
    adminauth = function(req,res,next) {next();};
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
  var admin_views = require('./admin.js')(app, schema, sequelize, adminauth);
  
  app.get('/',
          adminauth,  function (req, res) {
            res.redirect('/admin/');
          }
         );
  server = app.listen(config.port, function () {
    var port = server.address().port;
    console.log('App listening at %s:%s', config.baseUrl, port);
  });
}

if (require.main === module) {
  boot(configFile);
} else {
  exports.server = server;
  exports.boot = boot;
  exports.db = dbconn;
  exports.shutdown = shutdown;
}
