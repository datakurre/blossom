// ==========================================================================
// Project:   SproutCore - JavaScript Application Framework
// Copyright: ©2006-2010 Apple Inc. and contributors.
// License:   Licensed under MIT license (see license.js)
// ==========================================================================
var b, counter;

suite("SC.ButtonView#actions", {
	setup: function() {
	  b = SC.ButtonView.create();
	}
});

test("Emulate mouse click to verify if the button activates", function() {
  b.triggerAction();
  equals(b.get('isActive'), true, "the should be active for 200ms");
  
});


test("Test different moused states", function() {
  b.set('isEnabled', true);
  b.mouseDown();
  equals(b.get('isActive'), true, "the button should be active after a mouseDown event");
  b.mouseExited();
  equals(b.get('isActive'), false, "the button should be active after a mouseDown event");
  b.mouseEntered();
  equals(b.get('isActive'), b._isMouseDown, "the button should be active after a mouseDown event");  
//  b.mouseUp();
//  equals(b.get('isActive'), false, "the button should be inactive after a mouseUP event");

  b.set('buttonBehavior', SC.TOGGLE_BEHAVIOR);
  b._action();
  equals(b.get('value'), b.get('toggleOnValue'), "the value should be the same as the toggle value");
 
  b.set('buttonBehavior', SC.TOGGLE_ON_BEHAVIOR);
  b._action();
  equals(b.get('value'), b.get('toggleOnValue'), "the value should be the same as the toggle value");
  
  b.set('buttonBehavior', SC.TOGGLE_OFF_BEHAVIOR);
  b._action();
  equals(b.get('value'), b.get('toggleOffValue'), "the value should be the same as the toggle value");
});


suite("SC.ButtonView#actions - SC.HOLD_BEHAVIOR", {
  setup: function() {
    counter = SC.Object.create({
      value: 0,
      increment: function(){
        this.set('value', this.get('value') + 1);
      }
    });

    b = SC.ButtonView.create({
      buttonBehavior: SC.HOLD_BEHAVIOR,
      holdInterval: 5,
      target: counter,
      action: 'increment',

      // Is it a bad idea to stub like this? If we don't do it this way, we need to set up a Pane
      _runAction: function(evt) {
        var action = this.get('action'),
            target = this.get('target') || null;

        target[action]();
      }
    });
  }
});

test('Test triggerAction only happens once', function(){
  b.triggerAction();
  SC.RunLoop.begin().end();
  var assertions = function(){
    equals(counter.get('value'), 1, "should only run action once");
    start();
  };

  stop();
  setTimeout(assertions, 300);
});

// This test is not nearly reliable enough
test("Test action repeats while active", function(){
  b.set('isActive', true);
  b._action();

  var assertions = function(){
    // The actual number of times in not entirely predictable since there can be delays beyond the holdInterval
    ok(counter.get('value') > 2, "should have run more than 2 times");
    b.set('isActive', false); // Stops triggering
    start();
  };

  stop();
  setTimeout(assertions, 300);
});

test("Test action happens on mouseDown", function(){
  b.mouseDown();
  equals(counter.get('value'), 1, "should have run once");
  b.set('isActive', false); // Stops triggering
});

test("Test action does not happen on mouseUp", function(){
  b._isMouseDown = true;
  b.mouseUp();
  equals(counter.get('value'), 0, "should not have run");
});

test("Should stop when inactive", function(){
  b.set('isActive', true);
  b._action();
  b.set('isActive', false);

  var assertions = function(){
    equals(counter.get('value'), 1, "should only run action once");
    start();
  };

  stop();
  setTimeout(assertions, 10);
});
