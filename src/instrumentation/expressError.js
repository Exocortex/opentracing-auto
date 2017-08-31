'use strict'

const shimmer = require('shimmer')
const opentracing = require('opentracing')
const cls = require('../cls')

const OPERATION_NAME = 'express_error_handler'
const wrappedLayers = new Set()

function patch (express, tracers) {
  let lastLayer

  shimmer.wrap(express.Router, 'use', (originalUse) =>
    function errorHandler (...args) {
      const app = originalUse.call(this, ...args)

      // Remove error handler
      if (lastLayer) {
        unpatchLayer(lastLayer)
      }

      // Add error handler
      lastLayer = app.stack[app.stack.length - 1]

      if (!lastLayer) {
        return app
      }

      shimmer.wrap(lastLayer, 'handle_error', (originalHandleError) =>
        function (err, req, res, next) {
          const rootSpans = tracers.map((tracer) => cls.getRootSpan(tracer))

          if (rootSpans.length) {
            rootSpans.forEach((rootSpan) => rootSpan.setTag(opentracing.Tags.ERROR, true))
          }

          // error span
          const spans = tracers.map((tracer) => cls.startChildSpan(tracer, OPERATION_NAME))

          spans.forEach((span) => span.log({
            event: 'error',
            'error.object': err,
            message: err.message,
            stack: err.stack
          }))
          spans.forEach((span) => span.setTag(opentracing.Tags.ERROR, true))
          spans.forEach((span) => span.finish())

          return originalHandleError.call(this, err, req, res, next)
        }
      )
      wrappedLayers.add(lastLayer)

      return app
    }
  )
}

function unpatchLayer (layer) {
  shimmer.unwrap(layer, 'handle_error')
  wrappedLayers.delete(layer)
}

function unpatch (express) {
  shimmer.unwrap(express.Router, 'use')

  wrappedLayers.forEach(unpatchLayer)
}

module.exports = {
  module: 'express',
  supportedVersions: ['4.x'],
  OPERATION_NAME,
  patch,
  unpatch
}