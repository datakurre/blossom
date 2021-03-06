var view, contentA, contentB;

suite('ContentDisplay', {
  setup: function() {
    contentA = SC.Object.create({
      foo: 'foo.A',
      bar: 'bar.A'
    });

    contentB = SC.Object.create({
      foo: 'foo.B',
      bar: 'bar.B'
    });

    view = SC.View.create(SC.ContentDisplay, {
      contentDisplayProperties: ['foo', 'bar'],
      content: contentA
    });

    view.set('layerNeedsUpdate', false);
  }
});

test('should dirty layer when content changes', function () {
  view.set('content', contentB);
  ok(view.get('layerNeedsUpdate'));
});

test('should dirty layer when any of contentDisplayProperties change', function () {
  contentA.set('foo', 'newFoo');
  ok(view.get('layerNeedsUpdate'));
});

test('should stop observing old content when content changes', function () {
  ok(contentA.hasObserverFor('*'));
  view.set('content', contentB);
  ok(!contentA.hasObserverFor('*'));
});

test('should begin observing new content when content changes', function () {
  view.set('content', contentB);
  view.set('layerNeedsUpdate', false);
  contentB.set('bar', 'newBar');
  ok(view.get('layerNeedsUpdate'));
});

test('should stop observing content when destroyed', function () {
  ok(contentA.hasObserverFor('*'));
  view.destroy();
  ok(!contentA.hasObserverFor('*'));
});
