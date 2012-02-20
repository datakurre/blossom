// ==========================================================================
// Project:   Blossom - Modern, Cross-Platform Application Framework
// Copyright: ©2012 Fohr Motion Picture Studios. All rights reserved.
// License:   Licensed under the GPLv3 license (see BLOSSOM-LICENSE).
// ==========================================================================
/*globals BLOSSOM sc_assert */

sc_require('surfaces/surface');

if (BLOSSOM) {

SC.CompositeSurface = SC.Surface.extend(
  /** @scope SC.CompositeSurface.prototype */ {

  isCompositeSurface: true,

  // ..........................................................
  // PSURFACE SUPPORT (Private)
  //

  updatePsurface: function(psurface) {
    console.log('SC.CompositeSurface#updatePsurface()');
    sc_assert(psurface.__element__ && document.getElementById(this.get('id')) === psurface.__element__);
    var subsurfaces = this.get('subsurfaces');
    if (subsurfaces.get('length') > 0) {
      subsurfaces.forEach(function(surface, idx) {
        if (idx === 0) psurface.push(surface);
        else psurface.next(surface);

        if (surface.updatePsurface) surface.updatePsurface();
      }, this);
      psurface.pop();
    }
  },

  // ..........................................................
  // SURFACE TREE SUPPORT
  //

  // When the subsurfaces property changes, we need to observe it's members
  // for changes.
  _sc_subsurfaces: null,
  _sc_subsurfacesDidChange: function() {
    // console.log("SC.CompositeSurface#_sc_subsurfacesDidChange()");
    var cur  = this.get('subsurfaces'),
        last = this._sc_subsurfaces,
        func = this._sc_subsurfacesMembersDidChange;
        
    if (last === cur) return this; // nothing to do

    // teardown old observer
    if (last && last.isEnumerable) last.removeObserver('[]', this, func);
    
    // save new cached values 
    this._sc_subsurfaces = cur ;
    
    // setup new observers
    if (cur && cur.isEnumerable) cur.addObserver('[]', this, func);

    // process the changes
    this._sc_subsurfacesMembersDidChange();
  }.observes('subsurfaces'),

  _sc_subsurfacesMembersDidChange: function() {
    // console.log("SC.Surface#_sc_subsurfacesMembersDidChange()");
    this.get('subsurfaces').invoke('set', 'supersurface', this);
  },

  init: function() {
    arguments.callee.base.apply(this, arguments);
    this.set('subsurfaces', []);
  }

});

} // BLOSSOM
