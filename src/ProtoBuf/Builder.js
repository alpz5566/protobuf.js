/**
 * @alias ProtoBuf.Builder
 * @expose
 */
ProtoBuf.Builder = (function(ProtoBuf, Lang, Reflect) {
    "use strict";

    /**
     * Constructs a new Builder.
     * @exports ProtoBuf.Builder
     * @class Provides the functionality to build protocol messages.
     * @param {Object.<string,*>=} options Options
     * @constructor
     */
    var Builder = function(options) {

        /**
         * Namespace.
         * @type {ProtoBuf.Reflect.Namespace}
         * @expose
         */
        this.ns = new Reflect.Namespace(this, null, ""); // Global namespace

        /**
         * Namespace pointer.
         * @type {ProtoBuf.Reflect.T}
         * @expose
         */
        this.ptr = this.ns;

        /**
         * Resolved flag.
         * @type {boolean}
         * @expose
         */
        this.resolved = false;

        /**
         * The current building result.
         * @type {Object.<string,ProtoBuf.Builder.Message|Object>|null}
         * @expose
         */
        this.result = null;

        /**
         * Imported files.
         * @type {Array.<string>}
         * @expose
         */
        this.files = {};

        /**
         * Import root override.
         * @type {?string}
         * @expose
         */
        this.importRoot = null;

        /**
         * Options.
         * @type {!Object.<string, *>}
         * @expose
         */
        this.options = options || {};
    };

    /**
     * @alias ProtoBuf.Builder.prototype
     * @inner
     */
    var BuilderPrototype = Builder.prototype;

    // ----- Definition tests -----

    /**
     * Tests if a definition most likely describes a message.
     * @param {!Object} def
     * @returns {boolean}
     * @expose
     */
    Builder.isMessage = function(def) {
        // Messages require a string name
        if (typeof def["name"] !== 'string')
            return false;
        // Messages do not contain values (enum) or rpc methods (service)
        if (typeof def["values"] !== 'undefined' || typeof def["rpc"] !== 'undefined')
            return false;
        return true;
    };

    /**
     * Tests if a definition most likely describes a message field.
     * @param {!Object} def
     * @returns {boolean}
     * @expose
     */
    Builder.isMessageField = function(def) {
        // Message fields require a string rule, name and type and an id
        if (typeof def["rule"] !== 'string' || typeof def["name"] !== 'string' || typeof def["type"] !== 'string' || typeof def["id"] === 'undefined')
            return false;
        return true;
    };

    /**
     * Tests if a definition most likely describes an enum.
     * @param {!Object} def
     * @returns {boolean}
     * @expose
     */
    Builder.isEnum = function(def) {
        // Enums require a string name
        if (typeof def["name"] !== 'string')
            return false;
        // Enums require at least one value
        if (typeof def["values"] === 'undefined' || !Array.isArray(def["values"]) || def["values"].length === 0)
            return false;
        return true;
    };

    /**
     * Tests if a definition most likely describes a service.
     * @param {!Object} def
     * @returns {boolean}
     * @expose
     */
    Builder.isService = function(def) {
        // Services require a string name and an rpc object
        if (typeof def["name"] !== 'string' || typeof def["rpc"] !== 'object' || !def["rpc"])
            return false;
        return true;
    };

    /**
     * Tests if a definition most likely describes an extended message
     * @param {!Object} def
     * @returns {boolean}
     * @expose
     */
    Builder.isExtend = function(def) {
        if (typeof def["ref"] !== 'string')
            return false;
        return true;
    };

    // ----- Building -----

    /**
     * Resets the pointer to the root namespace.
     * @expose
     */
    BuilderPrototype.reset = function() {
        this.ptr = this.ns;
    };

    /**
     * Defines a namespace on top of the current pointer position and places the pointer on it.
     * @param {string} namespace
     * @return {!ProtoBuf.Builder} this
     * @expose
     */
    BuilderPrototype.define = function(namespace) {
        if (typeof namespace !== 'string' || !Lang.TYPEREF.test(namespace))
            throw Error("illegal namespace: "+namespace);
        namespace.split(".").forEach(function(part) {
            var ns = this.ptr.getChild(part);
            if (ns === null) // Keep existing
                this.ptr.addChild(ns = new Reflect.Namespace(this, this.ptr, part));
            this.ptr = ns;
        }, this);
        return this;
    };

    /**
     * Creates ths specified protocol types at the current pointer position.
     * @param {Array.<Object.<string,*>>} defs Messages, enums or services to create
     * @return {ProtoBuf.Builder} this
     * @throws {Error} If a message definition is invalid
     * @expose
     */
    BuilderPrototype.create = function(defs) {
        if (!defs)
            return this; // Nothing to create
        if (!Array.isArray(defs))
            defs = [defs];
        else {
            if (defs.length === 0)
                return this;
            defs = defs.slice();
        }

        // It's quite hard to keep track of scopes and memory here, so let's do this iteratively.
        var stack = [];
        stack.push(defs); // One level [a, b, c]
        while (stack.length > 0) {
            defs = stack.pop();
            if (Array.isArray(defs)) { // Stack always contains entire namespaces
                while (defs.length > 0) {
                    var def = defs.shift(); // Namespace always contains an array of messages, enums and services
                    if (Builder.isMessage(def)) {
                        var obj = new Reflect.Message(this, this.ptr, def["name"], def["options"], def["isGroup"], def["syntax"]);
                        // Create OneOfs
                        var oneofs = {};
                        if (def["oneofs"]) {
                            var keys = Object.keys(def["oneofs"]);
                            for (var i=0, k=keys.length; i<k; ++i)
                                obj.addChild(oneofs[keys[i]] = new Reflect.Message.OneOf(this, obj, keys[i]));
                        }
                        // Create fields
                        if (def["fields"] && def["fields"].length > 0) {
                            for (i=0, k=def["fields"].length; i<k; ++i) { // i:k=Fields
                                var fld = def['fields'][i];
                                if (obj.getChild(fld['id']) !== null)
                                    throw Error("Duplicate field id in message "+obj.name+": "+fld['id']);
                                if (fld["options"] && typeof fld["options"] !== 'object')
                                    throw Error("illegal field options in message "+obj.name+"#"+fld["name"]);
                                var oneof = null;
                                if (typeof fld["oneof"] === 'string') {
                                    oneof = oneofs[fld["oneof"]];
                                    if (typeof oneof === 'undefined')
                                        throw Error("Illegal oneof in message "+obj.name+"#"+fld["name"]+": "+fld["oneof"]);
                                }
                                fld = new Reflect.Message.Field(this, obj, fld["rule"], fld["keytype"], fld["type"], fld["name"], fld["id"], fld["options"], oneof, def["syntax"]);
                                if (oneof)
                                    oneof.fields.push(fld);
                                obj.addChild(fld);
                            }
                        }
                        // Push enums, messages and services to stack
                        var subObj = [];
                        if (typeof def["enums"] !== 'undefined' && def['enums'].length > 0)
                            for (i=0; i<def["enums"].length; i++)
                                subObj.push(def["enums"][i]);
                        if (def["messages"] && def["messages"].length > 0)
                            for (i=0; i<def["messages"].length; i++)
                                subObj.push(def["messages"][i]);
                        if (def["services"] && def["services"].length > 0)
                            for (i=0; i<def["services"].length; i++)
                                subObj.push(def["services"][i]);
                        // Set extension range
                        if (def["extensions"]) {
                            obj.extensions = def["extensions"];
                            if (obj.extensions[0] < ProtoBuf.ID_MIN)
                                obj.extensions[0] = ProtoBuf.ID_MIN;
                            if (obj.extensions[1] > ProtoBuf.ID_MAX)
                                obj.extensions[1] = ProtoBuf.ID_MAX;
                        }
                        this.ptr.addChild(obj); // Add to current namespace
                        if (subObj.length > 0) {
                            stack.push(defs); // Push the current level back
                            defs = subObj; // Continue processing sub level
                            subObj = null;
                            this.ptr = obj; // And move the pointer to this namespace
                            obj = null;
                            continue;
                        }
                        subObj = null;
                        obj = null;
                    } else if (Builder.isEnum(def)) {
                        obj = new Reflect.Enum(this, this.ptr, def["name"], def["options"], def["syntax"]);
                        for (i=0; i<def["values"].length; i++)
                            obj.addChild(new Reflect.Enum.Value(this, obj, def["values"][i]["name"], def["values"][i]["id"]));
                        this.ptr.addChild(obj);
                        obj = null;
                    } else if (Builder.isService(def)) {
                        obj = new Reflect.Service(this, this.ptr, def["name"], def["options"]);
                        for (i in def["rpc"])
                            if (def["rpc"].hasOwnProperty(i))
                                obj.addChild(new Reflect.Service.RPCMethod(this, obj, i, def["rpc"][i]["request"], def["rpc"][i]["response"], !!def["rpc"][i]["request_stream"], !!def["rpc"][i]["response_stream"], def["rpc"][i]["options"]));
                        this.ptr.addChild(obj);
                        obj = null;
                    } else if (Builder.isExtend(def)) {
                        obj = this.ptr.resolve(def["ref"], true);
                        if (obj) {
                            for (i=0; i<def["fields"].length; i++) { // i=Fields
                                if (obj.getChild(def['fields'][i]['id']) !== null)
                                    throw Error("Duplicate extended field id in message "+obj.name+": "+def['fields'][i]['id']);
                                if (def['fields'][i]['id'] < obj.extensions[0] || def['fields'][i]['id'] > obj.extensions[1])
                                    throw Error("Illegal extended field id in message "+obj.name+": "+def['fields'][i]['id']+" ("+obj.extensions.join(' to ')+" expected)");
                                // Convert extension field names to camel case notation if the override is set
                                var name = def["fields"][i]["name"];
                                if (this.options['convertFieldsToCamelCase'])
                                    name = ProtoBuf.Util.toCamelCase(def["fields"][i]["name"]);
                                // see #161: Extensions use their fully qualified name as their runtime key and...
                                fld = new Reflect.Message.ExtensionField(this, obj, def["fields"][i]["rule"], def["fields"][i]["type"], this.ptr.fqn()+'.'+name, def["fields"][i]["id"], def["fields"][i]["options"]);
                                // ...are added on top of the current namespace as an extension which is used for
                                // resolving their type later on (the extension always keeps the original name to
                                // prevent naming collisions)
                                var ext = new Reflect.Extension(this, this.ptr, def["fields"][i]["name"], fld);
                                fld.extension = ext;
                                this.ptr.addChild(ext);
                                obj.addChild(fld);
                            }
                        } else if (!/\.?google\.protobuf\./.test(def["ref"])) // Silently skip internal extensions
                            throw Error("Extended message "+def["ref"]+" is not defined");
                    } else
                        throw Error("Not a valid definition: "+JSON.stringify(def));
                    def = null;
                }
                // Break goes here
            } else
                throw Error("Not a valid namespace: "+JSON.stringify(defs));
            defs = null;
            this.ptr = this.ptr.parent; // This namespace is s done
        }
        this.resolved = false; // Require re-resolve
        this.result = null; // Require re-build
        return this;
    };

    /**
     * Propagates syntax to all children.
     * @param {!Object} parent
     * @inner
     */
    function propagateSyntax(parent) {
        if (parent['messages']) {
            parent['messages'].forEach(function(child) {
                child["syntax"] = parent["syntax"];
                propagateSyntax(child);
            });
        }
        if (parent['enums']) {
            parent['enums'].forEach(function(child) {
                child["syntax"] = parent["syntax"];
            });
        }
    }

    /**
     * Imports another definition into this builder.
     * @param {Object.<string,*>} json Parsed import
     * @param {(string|{root: string, file: string})=} filename Imported file name
     * @return {ProtoBuf.Builder} this
     * @throws {Error} If the definition or file cannot be imported
     * @expose
     */
    BuilderPrototype["import"] = function(json, filename) {
        if (typeof filename === 'string') {
            if (ProtoBuf.Util.IS_NODE)
                filename = ProtoBuf.Util.require("path")['resolve'](filename);
            if (this.files[filename] === true) {
                this.reset();
                return this; // Skip duplicate imports
            }
            this.files[filename] = true;
        } else if (typeof filename === 'object') { // Assume object with root, filename.
            var root = filename.root
            if (ProtoBuf.Util.IS_NODE)
                root = ProtoBuf.Util.require("path")['resolve'](root);
            var delim = '/';
            if (root.indexOf("\\") >= 0 || filename.file.indexOf("\\") >= 0) delim = '\\';
            var fname = [root, filename.file].join(delim);
            if (this.files[fname] === true) {
              this.reset();
              return this; // Skip duplicate imports
            }
            this.files[fname] = true;
        }
        if (!!json['imports'] && json['imports'].length > 0) {
            var importRoot, delim = '/', resetRoot = false;
            if (typeof filename === 'object') { // If an import root is specified, override
                this.importRoot = filename["root"]; resetRoot = true; // ... and reset afterwards
                importRoot = this.importRoot;
                filename = filename["file"];
                if (importRoot.indexOf("\\") >= 0 || filename.indexOf("\\") >= 0) delim = '\\';
            } else if (typeof filename === 'string') {
                if (this.importRoot) // If import root is overridden, use it
                    importRoot = this.importRoot;
                else { // Otherwise compute from filename
                    if (filename.indexOf("/") >= 0) { // Unix
                        importRoot = filename.replace(/\/[^\/]*$/, "");
                        if (/* /file.proto */ importRoot === "")
                            importRoot = "/";
                    } else if (filename.indexOf("\\") >= 0) { // Windows
                        importRoot = filename.replace(/\\[^\\]*$/, "");
                        delim = '\\';
                    } else
                        importRoot = ".";
                }
            } else
                importRoot = null;

            for (var i=0; i<json['imports'].length; i++) {
                if (typeof json['imports'][i] === 'string') { // Import file
                    if (!importRoot)
                        throw Error("Cannot determine import root: File name is unknown");
                    var importFilename = json['imports'][i];
                    if (importFilename === "google/protobuf/descriptor.proto")
                        continue; // Not needed and therefore not used
                    importFilename = importRoot + delim + importFilename;
                    if (this.files[importFilename] === true)
                        continue; // Already imported
                    if (/\.proto$/i.test(importFilename) && !ProtoBuf.DotProto)       // If this is a light build
                        importFilename = importFilename.replace(/\.proto$/, ".json"); // always load the JSON file
                    var contents = ProtoBuf.Util.fetch(importFilename);
                    if (contents === null)
                        throw Error("Failed to import '"+importFilename+"' in '"+filename+"': File not found");
                    if (/\.json$/i.test(importFilename)) // Always possible
                        this["import"](JSON.parse(contents+""), importFilename); // May throw
                    else
                        this["import"]((new ProtoBuf.DotProto.Parser(contents+"")).parse(), importFilename); // May throw
                } else // Import structure
                    if (!filename)
                        this["import"](json['imports'][i]);
                    else if (/\.(\w+)$/.test(filename)) // With extension: Append _importN to the name portion to make it unique
                        this["import"](json['imports'][i], filename.replace(/^(.+)\.(\w+)$/, function($0, $1, $2) { return $1+"_import"+i+"."+$2; }));
                    else // Without extension: Append _importN to make it unique
                        this["import"](json['imports'][i], filename+"_import"+i);
            }
            if (resetRoot) // Reset import root override when all imports are done
                this.importRoot = null;
        }
        if (json['package'])
            this.define(json['package']);
        if (json['syntax'])
            propagateSyntax(json);
        var base = this.ptr;
        if (json['options'])
            Object.keys(json['options']).forEach(function(key) {
                base.options[key] = json['options'][key];
            });
        if (json['messages'])
            this.create(json['messages']),
            this.ptr = base;
        if (json['enums'])
            this.create(json['enums']),
            this.ptr = base;
        if (json['services'])
            this.create(json['services']),
            this.ptr = base;
        if (json['extends'])
            this.create(json['extends']);
        this.reset();
        return this;
    };

    /**
     * Resolves all namespace objects.
     * @throws {Error} If a type cannot be resolved
     * @expose
     */
    BuilderPrototype.resolveAll = function() {
        // Resolve all reflected objects
        var res;
        if (this.ptr == null || typeof this.ptr.type === 'object')
            return; // Done (already resolved)
        if (this.ptr instanceof Reflect.Namespace) {
            // Build all children
            var children = this.ptr.children;
            for (var i= 0, k=children.length; i<k; ++i)
                this.ptr = children[i],
                this.resolveAll();
        } else if (this.ptr instanceof Reflect.Message.Field) {
            if (!Lang.TYPE.test(this.ptr.type)) { // Resolve type...
                if (!Lang.TYPEREF.test(this.ptr.type))
                    throw Error("Illegal type reference in "+this.ptr.toString(true)+": "+this.ptr.type);
                res = (this.ptr instanceof Reflect.Message.ExtensionField ? this.ptr.extension.parent : this.ptr.parent).resolve(this.ptr.type, true);
                if (!res)
                    throw Error("Unresolvable type reference in "+this.ptr.toString(true)+": "+this.ptr.type);
                this.ptr.resolvedType = res;
                if (res instanceof Reflect.Enum) {
                    this.ptr.type = ProtoBuf.TYPES["enum"];
                    if (this.ptr.syntax === 'proto3' && res.syntax !== 'proto3')
                        throw Error("Proto3 message refers to proto2 enum; " +
                                    "this is not allowed due to differing " +
                                    "enum semantics in proto3");
                }
                else if (res instanceof Reflect.Message)
                    this.ptr.type = res.isGroup ? ProtoBuf.TYPES["group"] : ProtoBuf.TYPES["message"];
                else
                    throw Error("Illegal type reference in "+this.ptr.toString(true)+": "+this.ptr.type);
            } else
                this.ptr.type = ProtoBuf.TYPES[this.ptr.type];

            // If it's a map field, also resolve the key type. The key type can
            // be only a numeric, string, or bool type (i.e., no enums or
            // messages), so we don't need to resolve against the current
            // namespace.
            if (this.ptr.map) {
                if (!Lang.TYPE.test(this.ptr.keyType))
                    throw Error("Illegal key type for map field in "+this.ptr.toString(true)+": "+this.ptr.type);
                this.ptr.keyType = ProtoBuf.TYPES[this.ptr.keyType];
            }
        } else if (this.ptr instanceof ProtoBuf.Reflect.Enum.Value) {
            // No need to build enum values (built in enum)
        } else if (this.ptr instanceof ProtoBuf.Reflect.Service.Method) {
            if (this.ptr instanceof ProtoBuf.Reflect.Service.RPCMethod) {
                res = this.ptr.parent.resolve(this.ptr.requestName, true);
                if (!res || !(res instanceof ProtoBuf.Reflect.Message))
                    throw Error("Illegal type reference in "+this.ptr.toString(true)+": "+this.ptr.requestName);
                this.ptr.resolvedRequestType = res;
                res = this.ptr.parent.resolve(this.ptr.responseName, true);
                if (!res || !(res instanceof ProtoBuf.Reflect.Message))
                    throw Error("Illegal type reference in "+this.ptr.toString(true)+": "+this.ptr.responseName);
                this.ptr.resolvedResponseType = res;
            } else {
                // Should not happen as nothing else is implemented
                throw Error("Illegal service type in "+this.ptr.toString(true));
            }
        } else if (!(this.ptr instanceof ProtoBuf.Reflect.Message.OneOf) && !(this.ptr instanceof ProtoBuf.Reflect.Extension))
            throw Error("Illegal object in namespace: "+typeof(this.ptr)+":"+this.ptr);
        this.reset();
    };

    /**
     * Builds the protocol. This will first try to resolve all definitions and, if this has been successful,
     * return the built package.
     * @param {(string|Array.<string>)=} path Specifies what to return. If omitted, the entire namespace will be returned.
     * @return {ProtoBuf.Builder.Message|Object.<string,*>}
     * @throws {Error} If a type could not be resolved
     * @expose
     */
    BuilderPrototype.build = function(path) {
        this.reset();
        if (!this.resolved)
            this.resolveAll(),
            this.resolved = true,
            this.result = null; // Require re-build
        if (this.result === null) // (Re-)Build
            this.result = this.ns.build();
        if (!path)
            return this.result;
        else {
            var part = typeof path === 'string' ? path.split(".") : path,
                ptr = this.result; // Build namespace pointer (no hasChild etc.)
            for (var i=0; i<part.length; i++)
                if (ptr[part[i]])
                    ptr = ptr[part[i]];
                else {
                    ptr = null;
                    break;
                }
            return ptr;
        }
    };

    /**
     * Similar to {@link ProtoBuf.Builder#build}, but looks up the internal reflection descriptor.
     * @param {string=} path Specifies what to return. If omitted, the entire namespace wiil be returned.
     * @param {boolean=} excludeNonNamespace Excludes non-namespace types like fields, defaults to `false`
     * @return {ProtoBuf.Reflect.T} Reflection descriptor or `null` if not found
     */
    BuilderPrototype.lookup = function(path, excludeNonNamespace) {
        return path ? this.ns.resolve(path, excludeNonNamespace) : this.ns;
    };

    /**
     * Returns a string representation of this object.
     * @return {string} String representation as of "Builder"
     * @expose
     */
    BuilderPrototype.toString = function() {
        return "Builder";
    };

    // Pseudo types documented in Reflect.js.
    // Exist for the sole purpose of being able to "... instanceof ProtoBuf.Builder.Message" etc.
    Builder.Message = function() {};
    Builder.Service = function() {};

    return Builder;

})(ProtoBuf, ProtoBuf.Lang, ProtoBuf.Reflect);
