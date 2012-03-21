// ==========================================================================
// Project:   Blossom - Modern, Cross-Platform Application Framework
// Copyright: ©2012 Fohr Motion Picture Studios. All rights reserved.
// License:   Licensed under the MIT license (see BUILDTOOLS-LICENSE).
// ==========================================================================
/*globals global require __dirname BT */

var http = require('http'),
    fs = require('fs'),
    path = require('path'),
    coffee = require('coffee-script'),
    crypto = require('crypto'),
    Graph = require('./utils/graph'); // needed for topological sorting

// Bootstrap the BT namespace with blossom/foundation.
require('./bootstrap');

function acceptBuilder(visitorMethod) {
  return function(visitor, key, depth) {
    var method = visitor[visitorMethod];

    if (typeof depth === "undefined") depth = 0;

    if (method && typeof method === "function") {
      visitor[visitorMethod](this, key, depth);
    }
  };
}

function traverse(kind) {
  // `kind` is unused currently
  return function(node, name, depth) {
    var conditionKey = 'canVisit';

    depth++;

    for (var key in node) {
      if (!node.hasOwnProperty(key)) continue;
      var obj = node[key];
      if (obj && obj.get && typeof obj.get === "function" &&
          obj.get(conditionKey) &&
          key !== 'project' && key !== 'parentNode') {
        // HACK: Make sure nodes know their parent and their name.
        if (!obj.get('nodeName')) obj.set('nodeName', key);
        if (!obj.get('parentNode')) obj.set('parentNode', node);

        obj.accept(this, key, depth);
      }
    }
  };
}

BT.Visitor = BT.Object.extend({
  visitPackage:      traverse("Package"),
  visitPackager:     traverse("Packager"),
  visitTarget:       traverse("Target"),
  visitProject:      traverse("Project"),
  visitDirectory:    traverse("Directory"),
  visitFile:         traverse("File"),
  visitBuildNode:    traverse("BuildNode"),
  visitApp:          traverse("App"),
  visitLocalization: traverse("Localization"),
  visitFramework:    traverse("Framework"),
  visitProxy:        traverse("Proxy")
});

function spaces(depth) {
  var ret = "", idx, len;
  for (idx = 0, len = depth; idx<len; ++idx) ret += "  ";
  return ret;
}

function log(kind) {
  return function(node, name, depth) {
    var sourceTree = node.get('sourceTree');
    console.log(spaces(depth)+"("+kind+") "+(name ? name : "")+(sourceTree? " ["+sourceTree+"]" : ""));
    arguments.callee.base.apply(this, arguments); // arguments.callee.base.apply(this, arguments);
  };
}

BT.LoggingVisitor = BT.Visitor.extend({
  visitPackage:      log("package"),
  visitPackager:     log("packager"),
  visitTarget:       log("target"),
  visitProject:      log("project"),
  visitDirectory:    log("directory"),
  visitFile:         log("file"),
  visitBuildNode:    log("build node"),
  visitApp:          log("app"),
  visitLocalization: log("localization"),
  visitFramework:    log("framework"),
  visitProxy:        log("proxy")
});

BT.BuildNode = BT.Object.extend({

  canVisit: true,
  isBuildNode: true,

  nodeName: null,
  parentNode: null,

  accept: acceptBuilder('visitBuildNode')

});

BT.File = BT.BuildNode.extend({

  isFile: true,
  isFileOrDirectory: true,

  sourcePath: null,
  sourceTree: null,

  relativePath: function() {
    var sourcePath = this.get('sourcePath'),
        sourceTree = path.normalize(this.get('sourceTree'));

    return sourcePath.slice(sourceTree.length+1);
  }.property().cacheable(),

  contents: function() {
    var ret = null;
    if (this.get('isJavaScript')) {
      ret = fs.readFileSync(this.get('sourcePath'), "utf-8");
    }
    else if (this.get('isCoffeeScript')) {
      ret = fs.readFileSync(this.get('sourcePath'), "utf-8");
      ret = coffee.compile(ret, { bare: true });
    }
    return ret;
  }.property(),

  scRequireDependencies: function() {
    var ary = [], lines = this.get('contents').split('\n'), that=this;

    var re = new RegExp("sc_require\\((['\"])(.*)\\1\\)");
    lines.forEach(function(line) {
      var statements = line.split(';');
      statements.forEach(function(statement) {
        var result = re.exec(statement);
        if (result) {
          ary.push(result[2]);
        }
      });
    });
    
    return ary;
  }.property().cacheable(),

  targetPath: function() {
    var ary = [], parentNode = this.get('parentNode');
    ary.push(this.get('nodeName'));
    while (parentNode) {
      ary.push(parentNode.get('nodeName'));
      parentNode = parentNode.get('parentNode');
    }
    return ary.reverse().join("/");
  }.property().cacheable(),

  isJavaScript: function() {
    return path.extname(this.get('sourcePath')) === ".js";
  }.property().cacheable(),

  isCoffeeScript: function() {
    return path.extname(this.get('sourcePath')) === ".coffee";
  }.property().cacheable(),

  accept: acceptBuilder('visitFile')

});

BT.Directory = BT.BuildNode.extend({

  isDirectory: true,
  isFileOrDirectory: true,

  accept: acceptBuilder('visitDirectory')

});

/** 
  @class
  
  A package is a logically separated/grouped structure containing
  source files that do not necessarily need to be loaded at the
  same time as the application. They are processed separately and
  handled slightly differently than normal targets.
  
  A package is implicitly derrived by convention: its location in
  the filesystem tree and the existence of a `node` directory that
  conains a `package.json` file. Packages can be nested inside any
  non-package directory (for organizational purposes) within a
  `packages` directory in an application or framework (although
  this is not strictly enforced at the moment).

  There are 3 types of packages: core, lazy and demand. Any core
  packages are processed and included with the application core
  source at initialization (but executed after any application
  dependencies and frameworks have been included but before the
  application core is loaded.
   
  Lazy packages are loaded automatically after the application has
  started (or manually...) but their source was not included with
  the application source and is loaded after (assists in alleviating
  the need to load and process an entired application at once).
  
  Last but not least demand packages are only loaded when needed.

  Configuration options are set via a specially named file in
  a package tree. There is a directory `node` with a `package.json`
  file. The properties in the json will be directly merged with the
  package object for evaluation during processing. This is where
  the type of package is specified by the property `type`. If no
  file is provided or no type is available it will be assumed to
  be a core package. The `dependencies` property (array) can contain
  the name of any packages the current package requires to be loaded
  first. Any dependencies must be from within the same framework or
  application as a dependence on a package from outside the housing
  target should be specified as a dependency of the target not the
  package.

*/
BT.Package = BT.BuildNode.extend(
  /** @lends BT.Package.prototype */ {

  //.............................................
  // PROPERTIES
  //

  /** 
    Walk like a duck?
  */
  isPackage: true,

  /**
    Make sure traversal will work properly. 
  */
  accept: acceptBuilder('visitPackage'),

  /**
    Traverse the package for files.
  */
  files: function() {
    var ret = [], that = this;

    this.accept(BT.Visitor.create({
      visitPackager: BT.K,
      visitPackage: function(node, name, depth) {
        if(node === that) arguments.callee.base.apply(this, arguments);
      },
      visitFramework: BT.K,
      visitApp: BT.K,
      visitTarget: BT.K,
      visitFile: function(node, name, depth) {
        ret.push(node);
        // arguments.callee.base.apply(this, arguments);
      }
    }));
    return ret;
  }.property().cacheable(),

  orderFiles: function(files) {
    var g = new Graph();
    var map = {};
    var requirePath = this.get('requirePath'),
        corePath = path.join(requirePath, 'core');

    files.forEach(function(file) {
      var relativePath = file.get('relativePath'),
          dependencies = file.get('scRequireDependencies') || [],
          dependencyPath;
      if (file.get('isJavaScript')) {
        dependencyPath = relativePath.slice(0, -3); // drop the '.js'
      }
      else if (file.get('isCoffeeScript')) {
        dependencyPath = relativePath.slice(0, -7); // drop the '.coffee'
      }
      map[dependencyPath] = file;
      g.addVertex(dependencyPath);
      dependencies.forEach(function(name) {
        g.addEdge(name, dependencyPath);
      });

      // packages aren't required to have a core.js file
      // but we leave this so that if they DO have one it is
      // still prioritized
      g.addEdge(corePath, dependencyPath);
    });

    var ret = [], sortedVertices = g.topologicalSort(), that=this;
    sortedVertices.forEach(function(vertex) {
      var dep = map[vertex];
      if (dep) ret.push(dep);

      // if there isn't a core file don't issue the
      // warning, we only care if it was there
      else if(vertex === corePath) return;
      else console.log('could not find '+that.get('sourceTree')+' package dependency: '+vertex);
    });
    return ret;
  },

  orderedJavaScriptFiles: function() {
    return this.orderFiles(this.get('files'));
  }.property().cacheable(),

  requirePath: function() {
    var sourceTree = this.get('sourceTree'),
        parentSourceTree = this.get('parentSourceTree');
    return sourceTree.slice(parentSourceTree.length+1);
  }.property().cacheable(),

  rootNode: function() {
    var root = this.parentNode;
    while(!root.isFramework && !root.isApp && root.parentNode)
      root = root.parentNode;
    return root ? root.get('nodeName') : null; 
  }.property(),
  
  clientReadySource: function() {
    var files = this.get('orderedJavaScriptFiles');
    var sources = [];
    var jsp = require('uglify-js').parser;
    var pro = require('uglify-js').uglify;
    var uuid = this.get('uuid');
    var contents;
    var ast;
    files.forEach(function(file) {
      contents = file.get('contents');
      ast = jsp.parse(contents);
      ast = pro.ast_mangle(ast);
      ast = pro.ast_squeeze(ast);
      contents = pro.gen_code(ast);
      sources.push(contents);
    });
    sources = sources.join(';');
    sources = sources.replace(/[\'\"]/g, '\\\'');
    sources = 'SC.PACKAGE_MANIFEST[\''+uuid+'\'].source=\''+sources+'\';';
    return sources;
  }.property().cacheable(),

  //.............................................
  // METHODS
  //

  /** @private */
  init: function() {
    arguments.callee.base.apply(this, arguments);
    var sourceTree = this.get('sourceTree'),
        parentSourceTree = this.get('parentSourceTree'),
        parentBaseName = path.basename(parentSourceTree),
        that = this;

    this.basename = path.basename(sourceTree);

    function processDirectory(dirname, node, deep) {
      var files = fs.readdirSync(dirname);
      files.forEach(function(filename) {

        var relativePath = path.join(dirname, filename);
        var stat = fs.statSync(relativePath);
        var ext = path.extname(filename);
        if (stat.isFile() && ext in {'.js':'','.coffee':''}) {
          node.set(filename, BT.PackageFile.create({
            sourcePath: relativePath,
            sourceTree: sourceTree,
            parentSourceTree: parentSourceTree
          }));
        } else if (stat.isDirectory()) {

          // look to see if there are specific settings
          // for this package
          if (filename === "node") {
            var nodeFiles = filesFrom(relativePath);

            // if package.json file does exist
            if(!!~nodeFiles.indexOf('package.json')) {
              var json, content;
              try {
                content = fs.readFileSync(path.join(relativePath, 'package.json'), 'utf8');
                try {
                  json = JSON.parse(content);

                  // apply properties to self
                  that.mixin(json);
                } catch (err) {
                  console.log("json error in package configuration file(package.json) for "+
                    "package %@ in %@: ".fmt(that.basename, parentBaseName) + err.message);
                }
              } catch(err) {
                console.log("could not read package.json file for package "+
                  "%@ in %@".fmt(that.basename, parentBaseName));
              }

            // should never get here now but just in case...
            } else { 
              console.log("could not find a package.json file for package %@ ".fmt(that.basename)+
                "in %@!".fmt(parentBaseName));
            }
          }

          // skip a directory named 'apps'
          else if (filename === 'apps') return;

          // skip a directory named 'frameworks'
          else if (filename === 'frameworks') return;

          // skip a directory names 'packages'
          else if (filename === 'packages') return;
          else {
            var dir = BT.Directory.create();
            node.set(filename, dir);
            processDirectory(relativePath, dir, true);
          }
        } else {
          console.log("the file is something strange => %@".fmt(relativePath));
        }
      });
    }

    if (sourceTree) processDirectory(sourceTree, this);
    else console.log("package with no sourcetree?");

    if(!this.type) this.type = 'core';
  }

});

BT.PackageFile = BT.File.extend(
  /** @lends BT.PackageFile.prototype */ {

  parentSourceTree: null,

  relativePath: function() {
    var sourcePath = this.get('sourcePath'),
        sourceTree = path.normalize(this.get('parentSourceTree'));
    return sourcePath.slice(sourceTree.length+1);
  }.property().cacheable(),

  requirePath: function() {
    var sourceTree = this.get('sourceTree'),
        parentSourceTree = this.get('parentSourceTree');
    return sourceTree.slice(parentSourceTree.length+1);
  }.property().cacheable(),

  scRequireDependencies: function() {
    var ary = arguments.callee.base.apply(this, arguments), 
        that = this,
        ret = [];
    ary.forEach(function(required) { 
      ret.push(path.join(that.get('requirePath'), required));
    });
    return ret;
  }.property().cacheable()

});

//...............................................
// Package configuration flags
// 
// generate hashes for the uuid of valid packages
function __sha1hash__() {
  return crypto.createHash('sha1');
}
// convenience method to return array of only files
// from a root path
function filesFrom(root) {
  var files = fs.readdirSync(root), stat, fullPath;
  files = files.filter(function(file) {
    fullPath = path.join(root, file);
    stat = fs.statSync(fullPath);
    return stat.isFile();
  });
  return files;
}
//...............................................

/**
*/
BT.Packager = BT.BuildNode.extend(
  /** @lends BT.Packager.prototype */ {

  isPackager: true,

  accept: acceptBuilder('visitPackager'),

  //..............................................
  // CALCULATED PROPERTIES
  //

  /**
    @property

    The generated manifest for all packages in this
    package directory.
  */
  manifest: function() {
    var manifest = '',
        packages = this.get('orderedPackages'),
        that = this;
    function findRoot(package) {
      var root = package.parentNode;
      while(!root.isFramework && !root.isApp && root.parentNode)
        root = root.parentNode;
      return root ? '\'' + root.get('nodeName') + '\'' : 'null'; 
    }
    function dependenciesFor(package) {
      var str = '\n', 
          dependencies = package.dependencies, depName, dep;
      if(BT.typeOf(dependencies) === BT.T_ARRAY) {
        str = ',\n    "dependencies": [\n';
        dependencies.forEach(function(depName, idx) {
          dep = that.findPackage(depName);
          if(!dep) return console.log("could not find package dependency "+
            "%@ by %@".fmt(depName, package.get('basename'))+
            ", remember packages can't depend on packages in other frameworks");
          str += '      "' + depName + '"';
          if(idx < dependencies.length-1) str += ',\n'; 
        });
        str += '\n    ]\n';
      }
      return str;
    }
    packages.forEach(function(package, idx) {
      var type = package.get('type');
      manifest += '  "' + package.get('nodeName') + '": {\n';
      manifest += '    "basename": \'' + package.get('basename') + '\',\n';
      manifest += '    "type": \'' + type + '\',\n';
      manifest += '    "rootNode": ' + findRoot(package) + ',\n';
      manifest += '    "isLoaded": ' + (type === 'core' ? 'true' : 'false') + ',\n';
      manifest += '    "isReady": ' + (type === 'core' ? 'true' : 'false');
      manifest += dependenciesFor(package),
      manifest += '  }';
      if(idx < packages.length-1) manifest += ',\n';
    });
    return manifest;
  }.property(),

  orderedPackageFiles: function() {
    var ret = [],
        that = this,
        packages = this.get('orderedPackages');
    packages.forEach(function(package) {
      ret = ret.concat(package.get('orderedCoreJavaScriptFiles'));
    });
    return ret;
  }.property().cacheable(),

  orderedPackages: function() {
    var ret = [],
        that = this,
        packages = this.get('packages'),
        g = new Graph(),
        map = {}, sorted;

    packages.forEach(function(package) {
      var dependencies = package.dependencies || [],
          name = package.get('nodeName');
      map[name] = package;
      g.addVertex(name);
      dependencies.forEach(function(dependency) {
        var uuid = that.findPackage(dependency);
        if(uuid) {
          if(package.get('type') === 'core' && uuid.get('type') !== 'core') {
            console.log("core package depends on non-core package, "+
              "forcing non-core (%@) dependency to core".fmt(uuid.get('basename')));
            uuid.set('type', 'core');
          }
          uuid = uuid.get('uuid');
        }
        else console.log("things are gonna get ugly, couldn't find dependency "+
          "%@ for package %@ in %@".fmt(dependency, package.get('basename'),
          path.basename(package.get('parentSourceTree'))));
        g.addEdge(uuid, name);
      });
    });

    sorted = g.topologicalSort(); 

    sorted.forEach(function(vertex) {
      var dependency = map[vertex];
      if(dependency) ret.push(dependency);
    });

    return ret;
  }.property().cacheable(),

  packages: function() {
    var ret = [];
    this.accept(BT.Visitor.create({
      visitPackage: function(node, name, depth) {
        ret.push(node);
      }
    }));
    return ret;
  }.property().cacheable(),

  /**
    Returns a package if it can find it. First tests by
    direct index (uuid) and if not attempts to find one
    by name.

    @param {String} uuid Either the uuid of the package or
      the basename (directory name) of the package.
    @returns {BT.Package} The package request or null if
      it could not be found.
  */
  findPackage: function(uuid) {
    var ret = this.get(uuid), packages;
    if(!ret) {
      packages = this.get('packages');
      ret = packages.find(function(package) {
        if(package.get('basename') === uuid)
          return package;
        else return false;
      });
    }
    return ret;
  },

  init: function() {

    arguments.callee.base.apply(this, arguments);
    var sourceTree = this.get('sourceTree'),
        parentSourceTree = this.get('parentSourceTree'),
        that = this;

    function isPackageDir(source) {
      var stat, packageSource;
      packageSource = path.join(source, 'node', 'package.json');
      try {
        stat = fs.statSync(packageSource);
        return stat.isFile();
      } catch(err) {
        return false;
      }
    }

    function processDirectory(dirname, node) {
      var files = fs.readdirSync(dirname);
      if(files.length <= 0) return console.log("no packages in directory?");
      files.forEach(function(filename) {
        if (filename === "node") return;
        var relativePath = path.join(dirname, filename),
            stat = fs.statSync(relativePath);

        // we don't want files
        if (stat.isFile()) return;

        // we are after directories...
        else if (stat.isDirectory()) {
          if(!isPackageDir(relativePath)) {
            // lets see if this directory has any packages
            return processDirectory(relativePath, node);
          }
          var uuid = that.uuid(),
              package = BT.Package.create({
                sourceTree: relativePath,
                parentSourceTree: parentSourceTree,
                uuid: uuid
              });
          node.set(uuid, package);
          // node.set(filename, package);
        } else {
          console.log("the file is something strange => %@".fmt(relativePath));
        }
      });
    }

    if (sourceTree) processDirectory(sourceTree, this);
    else console.log("packages directory found but no source tree specified?");

    // this is a cached calculated property that forces the dependencies
    // to be evaluated early and determine if there are any issues
    // this must be done here to ensure that corrections that can be
    // made arbitrarily are issued before any html is generated
    // in the index files
    this.get('orderedPackages');
  },

  uuid: function() {
    return __sha1hash__().update(Math.random().toString()).digest('hex');
  },

});


BT.Target = BT.BuildNode.extend({

  isTarget: true,

  concatenatedProperties: 'frameworks'.w(),
  frameworks: [],

  // The source tree this target pulls files from.
  sourceTree: null,

  accept: acceptBuilder('visitTarget'),

  files: function() {
    var ret = [], that = this;
    this.accept(BT.Visitor.create({
      // only visit our own framework, not any other (embedded) targets
      visitFramework: function(node, name, depth) {
        if (node === that) arguments.callee.base.apply(this, arguments);
      },
      visitApp: BT.K,
      visitTarget: BT.K,
      visitFile: function(node, name, depth) {
        ret.push(node);
        arguments.callee.base.apply(this, arguments);
      },
      visitPackager: BT.K,
      visitPackage: BT.K
    }));

    return ret;
  }.property().cacheable(),

  orderedJavaScriptFiles: function() {
    var ary = this.get('files').filter(function(file) {
      var relativePath = file.get('relativePath');
      if (relativePath.slice(0,4) === "test") return false;
      else if (relativePath.slice(0,4) === "node") return false;
      else if (relativePath.match(/test_suite/)) return false;
      else return file.get('isJavaScript') || file.get('isCoffeeScript');
    });

    // need to sort the ary by require dependencies...
    var g = new Graph();
    var map = {};

    ary.forEach(function(file) {

      var relativePath = file.get('relativePath'),
          dependencies = file.get('scRequireDependencies') || [],
          dependencyPath;

      if (file.get('isJavaScript')) {
        dependencyPath = relativePath.slice(0, -3); // drop the '.js'
      }
      else if (file.get('isCoffeeScript')) {
        dependencyPath = relativePath.slice(0, -7); // drop the '.coffee'
      }
      map[dependencyPath] = file;
      g.addVertex(dependencyPath);
      dependencies.forEach(function(name) {
        g.addEdge(name, dependencyPath);
      });
      g.addEdge("core", dependencyPath);
    });

    var ret = [], sortedVertices = g.topologicalSort(), that=this;
    sortedVertices.forEach(function(vertex) {
      var dep = map[vertex];
      if (dep) ret.push(dep);
      else console.log('could not find '+that.get('nodeName')+' framework dependency: '+vertex);
    });
    
    ret = ret.concat(this.get('orderedCorePackageFiles'));

    // console.log(ret.map(function(f) { return f.get('targetPath'); }));
    return ret;
  }.property().cacheable(),

  orderedFrameworks: function() {
    var project = this.get('project'),
        frameworks = this.get('frameworks'),
        ary = [];

    if (!project) return ary;

    function processFramework(name, parent) {
      // console.log(name);
      var framework = project.findFramework(name, parent),
          dependencies = framework ? framework.get('frameworks') : null;

      if (dependencies) {
        dependencies.forEach(function(dep) {
          processFramework(dep, framework);
        });
        ary.push(framework);
      }
    }

    frameworks.forEach(function(name) {
      processFramework(name);
    });

    // console.log(ary.map(function(f) { return f.get('nodeName'); }));
    return ary;
  }.property(),


  //................................................
  // PACKAGE
  //

  /**
    Even if packages are present they will be ignored
    if this boolean is set to false. This does not mean the
    packages will not be processed for developmental and
    production purposes during build. A framework can be
    used between multiple applications with varying needs.
    Thus packages are always processed but only used when
    the application requires them.

    @type Boolean
    @default false
  */
  usePackages: true,

  /**
    Supplies a manifest to be included with the source
    of an application so that packages are known to
    the application before they are loaded.
  */
  packageManifest: function() {
    if(this.get('usePackages') === false) return;
    var frameworks = this.get('orderedFrameworks'),
        packagers = [], globalManifest;
    globalManifest = 'SC.PACKAGE_MANIFEST = {\n';
    frameworks.forEach(function(framework) {
      framework.accept(BT.Visitor.create({
        visitPackager: function(node) {
          packagers.push(node);
        }
      }));
    });
    var packager = this.get('packages');
    if(packager) packagers.push(packager);

    packagers.forEach(function(packager, idx) {
      globalManifest += packager.get('manifest');
      if(idx < packagers.length-1) globalManifest += ',\n';
    });
    globalManifest += '\n}';
    return globalManifest;
  }.property('usePackages').cacheable(),

  orderedCorePackageFiles: function() {
    var packager = this.get('packages'),
        packageFiles = [], packages;
    if(!packager) return packageFiles;
    packages = packager.get('orderedPackages');
    packages.forEach(function(package) {
      if(package.get('type') !== 'core') return;
      packageFiles = packageFiles.concat(
        package.get('orderedJavaScriptFiles')
      );
    });
    return packageFiles;
  }.property().cacheable(),

  /**
  */
  orderedPackageFiles: function() {
    var packager = this.get('packages'),
        packageFiles;
    if(!packager) return [];
    packageFiles = packager.get('orderedPackageFiles');
    return packageFiles || [];
  }.property().cacheable(),

  // 
  // END PACKAGE CONFIGURATION PROPERTIES
  //................................................


  init: function() {
    arguments.callee.base.apply(this, arguments);
    var sourceTree = this.get('sourceTree'),
        frameworks = this.get('frameworks'),
        that = this;

    function processDirectory(dirname, node, deep) {
      var files = fs.readdirSync(dirname);
      files.forEach(function(filename) {
        if (filename === "node") return;
        var relativePath = path.join(dirname, filename);
        var stat = fs.statSync(relativePath);
        if (stat.isFile()) {
          node.set(filename, BT.File.create({
            sourcePath: relativePath,
            sourceTree: sourceTree
          }));
        } else if (stat.isDirectory()) {
          // Skip directories named after embedded frameworks.
          if (frameworks.indexOf(filename) !== -1) return;

          // Skip a directory named 'apps'
          else if (filename === 'apps') return;

          // Skip a directory named 'frameworks'
          else if (filename === 'frameworks') return;

          // Process a `packages` directory now
          else if (filename === 'packages') {
            var packager = BT.Packager.create({
              sourceTree: relativePath,
              parentSourceTree: sourceTree
            });
            node.set(filename, packager);
          }
          else {
            var dir = BT.Directory.create();
            node.set(filename, dir);
            processDirectory(relativePath, dir, true);
          }
        } else {
          console.log("the file is something strange");
        }
      });
    }

    if (sourceTree) processDirectory(sourceTree, this);
  }


});

BT.Project = BT.BuildNode.extend({

  isProject: true,

  accept: acceptBuilder('visitProject'),

  apps: function() {
    var ret = [];

    var visitor = BT.Visitor.create({
      visitApp: function(node, name, depth) {
        ret.push(node);
        arguments.callee.base.apply(this, arguments);
      }
    });

    this.accept(visitor);

    return ret;
  }.property(),

  /**
    Returns the app if `str` refers to an app is this project; null otherwise.
  */
  findApp: function(str) {
    var ret = null, expected = "found-it";

    var visitor = BT.Visitor.create({
      visitApp: function(node, name, depth) {
        if (name === str) {
          ret = node;
          throw expected;
        } else {
          arguments.callee.base.apply(this, arguments);
        }
      }
    });

    try {
      this.accept(visitor);
    } catch (e) {
      if (e !== expected) throw e;
    }

    return ret;
  },

  /**
    Returns the framework if `str` refers to a framework is this project; 
    null otherwise. Start the search from `root` when present.
  */
  findFramework: function(str, root) {
    var ret = null, expected = "found-it";

    if (!root) root = this;

    var visitor = BT.Visitor.create({
      visitFramework: function(node, name, depth) {
        if (name === str) {
          ret = node;
          throw expected;
        } else {
          arguments.callee.base.apply(this, arguments);
        }
      }
    });

    try {
      root.accept(visitor);
    } catch (e) {
      if (e !== expected) throw e;
    }

    return ret;
  },

  /**
    Returns the app if `str` refers to an app is this project; null otherwise.
  */
  findProxy: function(str) {
    var ret = null, expected = "found-it";

    var visitor = BT.Visitor.create({
      visitProxy: function(node, name, depth) {
        // console.log("finding proxy", name);
        if (name === str) {
          ret = node;
          throw expected;
        } else {
          arguments.callee.base.apply(this, arguments);
        }
      }
    });

    try {
      this.accept(visitor);
    } catch (e) {
      if (e !== expected) throw e;
    }

    // console.log(ret);
    return ret;
  },

  indexHTML: function() {
    var ret = "", project = this.get('project'),
        isBuilding = this.get('isBuilding');

    ret += '<html>\n';
    ret += '  <head>\n';
    ret += '    <title>Blossom Project</title>\n';
    ret += '    <style>\n';
    ret += '      .sc-pane { position: absolute; margin: 0; }\n';
    ret += '    </style>\n';

    ret += '  </head>\n';
    ret += '  <body style="background: #fdf6e3; margin: 40; overflow: hidden;">\n';

    ret += '    <h2>Welcome to Blossom.</h2>\n';
    ret += "    <p>Here's a list of apps in this project:\n";
    ret += '      <ul>\n';
    this.get('apps').forEach(function outputAppListItem(app) {
      ret += '        <li><a href="' + app.get('nodeName')+(isBuilding? '/index.html' : '') + '">'+app.get('nodeName')+'</a></li>\n';
    });
    ret += '      </ul>\n';
    ret += '     </p>\n';

    ret += '  </body>\n';
    ret += '</html>';
    
    return ret;
  }.property(),

  init: function() {
    arguments.callee.base.apply(this, arguments);

    var project = this;

    // HACK: Make sure every node knows what project it's part of.
    function setProject() {
      return function(node, name, depth) {
        node.set('project', project);
        arguments.callee.base.apply(this, arguments);
      };
    }

    project.accept(BT.Visitor.create({
      visitPackage:      setProject(),
      visitTarget:       setProject(),
      visitDirectory:    setProject(),
      visitFile:         setProject(),
      visitBuildNode:    setProject(),
      visitApp:          setProject(),
      visitLocalization: setProject(),
      visitFramework:    setProject()
    }));

    this.projectPath = path.dirname(module.parent.filename);
  },

  serve: function(host, port) {
    host = host === undefined? 'localhost': host;
    port = port === undefined? 4020 : port;

    BT.Server.create({
      project: this,
      host: host,
      port: port
    });
  },

  build: function() {
    var that = this, visitor,
        assert = require('assert');

    this.set('isBuilding', true);

    visitor = BT.Visitor.create({
      visitApp: function(node, name, depth) {
        console.log(name, '...');
        that.buildApp(name);
        arguments.callee.base.apply(this, arguments);
      }
    });

    this.accept(visitor);

    var buildPath = path.join(this.get('projectPath'), 'build');
    console.log("Building apps in ", buildPath);
    if (!path.existsSync(buildPath)) {
      try {
        fs.mkdirSync(buildPath);
      } catch (e) {
        console.log('failed to create build directory at '+buildPath);
        console.log(e);
        console.log('aborting build');
        return;
      }
    }
    assert(path.existsSync(buildPath));

    console.log('Writing index.html ...');
    fs.writeFileSync(path.join(buildPath, 'index.html'), this.get('indexHTML'), 'utf-8');

    this.set('isBuilding', false);
    console.log('Done.');
  },

  buildApp: function(name) {
    var fs = require('fs'),
        assert = require('assert');

    var app = this.findApp(name),
        indexHTML = app? app.get('productionIndexHTML') : null,
        javascriptFiles = app? app.get('javascriptSourceFiles'): null, // an array
        buildPath = path.join(__dirname, '../build'), appPath;

    if (!app) {
      console.log("Build error: "+name+" could not be found.");
      return;
    }

    if (!path.existsSync(buildPath)) {
      try {
        fs.mkdirSync(buildPath);
      } catch (e) {
        console.log('failed to create build directory at '+buildPath);
        console.log(e);
        console.log('aborting build');
        return;
      }
    }
    assert(path.existsSync(buildPath));

    appPath = path.join(buildPath, app.get('nodeName'));
    if (!path.existsSync(appPath)) {
      try {
        fs.mkdirSync(appPath);
      } catch (e2) {
        console.log('failed to create app directory at '+appPath);
        console.log(e2);
        console.log('aborting build');
        return;
      }
    }
    assert(path.existsSync(appPath));

    fs.writeFileSync(path.join(appPath, 'index.html'), indexHTML, 'utf-8');

    var javascript = [];
    javascriptFiles.forEach(function(p) {
      if (path.existsSync(p)) {
        javascript.push(fs.readFileSync(p, 'utf-8'));
      }
    });
    javascript = javascript.join(';\n');

    // var jsp = require("uglify-js").parser;
    // var pro = require("uglify-js").uglify;
    // var ast = jsp.parse(javascript); // parse code and get the initial AST
    // 
    // ast = pro.ast_mangle(ast); // get a new AST with mangled names

    // These isn't working yet.
    // ast = pro.ast_squeeze(ast); // get an AST with compression optimizations

    // javascript = pro.gen_code(ast); // compressed code here

    fs.writeFileSync(path.join(appPath, 'application.js'), javascript, 'utf-8');
  }

});

BT.App = BT.Target.extend({

  isApp: true,

  // Configuration options.
  title: 'Blossom',

  FAST_LAYOUT_FUNCTION: false,
  BENCHMARK_LAYOUT_FUNCTION: true,
  ENFORCE_BLOSSOM_2DCONTEXT_API: true,
  DEBUG_PSURFACES: false,

  accept: acceptBuilder('visitApp'),

  files: function() {
    var ret = [], that = this;
    this.accept(BT.Visitor.create({
      // only visit our own app, not any other (embedded) targets
      visitFramework: BT.K,
      visitPackager: BT.K,
      visitPackage: BT.K,
      visitApp: function(node, name, depth) {
        if (node === that) arguments.callee.base.apply(this, arguments);
      },
      visitTarget: BT.K,
      visitFile: function(node, name, depth) {
        ret.push(node);
        arguments.callee.base.apply(this, arguments);
      }
    }));

    return ret;
  }.property().cacheable(),

  indexHTML: function() {
    var ret = "", project = this.get('project');

    ret += '<html>\n';
    ret += '  <head>\n';
    ret += '    <title>%@</title>\n'.fmt(this.get('title'));

    ret += '    <script>\n';
    ret += '      var FAST_LAYOUT_FUNCTION = %@;\n'.fmt(this.FAST_LAYOUT_FUNCTION);
    ret += '      var BENCHMARK_LAYOUT_FUNCTION = %@;\n'.fmt(this.BENCHMARK_LAYOUT_FUNCTION);
    ret += '      var ENFORCE_BLOSSOM_2DCONTEXT_API = %@;\n'.fmt(this.ENFORCE_BLOSSOM_2DCONTEXT_API);
    ret += '      var DEBUG_PSURFACES = %@;\n'.fmt(this.DEBUG_PSURFACES);
    ret += '    </script>\n';

    function outputScriptTag(file) {
      ret += '    <script src="' + file.get('targetPath') + '"></script>\n';
    }

    this.get('orderedFrameworks').forEach(function(framework) {
      var files = framework.get('orderedJavaScriptFiles');
      files.forEach(outputScriptTag);
    });

    // package manifest is written here to keep from writing a temporary file
    // during development (and kept in a more human-friendly form)
    if(this.get('packageManifest')) {
      ret += "<script>\n" + this.get('packageManifest') + "\n</script>\n";
    }

    var files = this.get('orderedJavaScriptFiles');
    files.forEach(outputScriptTag);

    ret += '    <style>\n';
    ret += '      * { -moz-box-sizing: border-box; -webkit-box-sizing: border-box; box-sizing: border-box; }\n';
    ret += '      div, canvas { border-style: solid; border-width: 0; }\n';
    ret += '      #ui { border-style: none }\n';
    ret += '    </style>\n';
    ret += '  </head>\n';
    
    ret += '  <body style="background: black; margin: 0; overflow: hidden;">\n';
    ret += '  </body>\n';
    ret += '</html>';

    return ret;
  }.property(),

  javascriptSourceFiles: function() {
    var ary = [], project = this.get('project');

    this.get('orderedFrameworks').forEach(function(framework) {
      var files = framework.get('orderedJavaScriptFiles');
      files.forEach(function(file) { ary.push(file.get('sourcePath')); });
    });

    var files = this.get('orderedJavaScriptFiles');
    files.forEach(function(file) { ary.push(file.get('sourcePath')); });

    return ary;
  }.property(),

  productionIndexHTML: function() {
    var ret = "", project = this.get('project');

    ret += '<html>\n';
    ret += '  <head>\n';
    ret += '    <title>%@</title>\n'.fmt(this.get('title'));

    ret += '    <script>\n';
    ret += '      var FAST_LAYOUT_FUNCTION = %@;\n'.fmt(this.FAST_LAYOUT_FUNCTION);
    ret += '      var BENCHMARK_LAYOUT_FUNCTION = %@;\n'.fmt(this.BENCHMARK_LAYOUT_FUNCTION);
    ret += '      var ENFORCE_BLOSSOM_2DCONTEXT_API = %@;\n'.fmt(this.ENFORCE_BLOSSOM_2DCONTEXT_API);
    ret += '      var DEBUG_PSURFACES = %@;\n'.fmt(this.DEBUG_PSURFACES);
    ret += '    </script>\n';

    ret += '    <script src="application.js"></script>\n';

    ret += '    <style>\n';
    ret += '      * { -moz-box-sizing: border-box; -webkit-box-sizing: border-box; box-sizing: border-box; }\n';
    ret += '      div, canvas { border-style: solid; border-width: 0; }\n';
    ret += '      #ui { border-style: none }\n';
    ret += '    </style>\n';
    ret += '  </head>\n';
    
    ret += '  <body style="background: black; margin: 0; overflow: hidden;">\n';
    ret += '  </body>\n';
    ret += '</html>';

    return ret;
  }.property(),

  usePackages: true,

});

BT.Localization = BT.Target.extend({

  isLocalization: true,

  accept: acceptBuilder('visitLocalization')

});

BT.Framework = BT.Target.extend({

  isFramework: true,

  accept: acceptBuilder('visitFramework')

});

BT.Proxy = BT.BuildNode.extend({

  isProxy: true,

  accept: acceptBuilder('visitProxy'),

  proxyHost: '127.0.0.1',

  proxyPort: 8080,

  proxyPrefix: '/',

  handle: function(request, response, prefix, serverPort) {
    var body = '', that = this;

    // request.addListener('data', function(chunk) {
    request.on('data', function(chunk) {
      body += chunk;
    }).on('end', function() {
      var proxyClient, proxyRequest,
          url = request.url;

      url = url.replace(prefix, that.get('proxyPrefix'));

      proxyClient = http.request({
        port: that.get('proxyPort'), 
        host: that.get('proxyHost'),
        path: url,
        method: 'POST'
      }, function(proxyResponse) {
        response.writeHead(proxyResponse.statusCode, proxyResponse.headers);
        proxyResponse.on('data', function(chunk) {
          response.write(chunk, 'binary');
        }).on('end', function() {
          response.end();
        });
      });

      proxyClient.on('error', function(err) {
        console.error('ERROR: "' + err.message + '" for proxy request on ' + that.get('proxyHost') + ':' + that.get('proxyPort'));
        response.writeHead(404);
        response.end();
      });

      request.headers.host = that.get('proxyPort');
      request.headers['content-length'] = body.length;
      request.headers['X-Forwarded-Host'] = request.headers.host + ':' + serverPort;
      if (that.get('proxyPort') != 80) request.headers.host += ':' + that.get('proxyPort');

      if (body.length > 0) { proxyClient.write(body, 'binary'); }

      proxyClient.end();
    });
  }

});

require('./server');
