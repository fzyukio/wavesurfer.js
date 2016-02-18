'use strict';

WaveSurfer.Spectrogram = {
    init: function (params) {
        this.params = params;
        var wavesurfer = this.wavesurfer = params.wavesurfer;

        if (!this.wavesurfer) {
            throw Error('No WaveSurfer instance provided');
        }

        this.frequenciesDataUrl = params.frequenciesDataUrl;

        var drawer = this.drawer = this.wavesurfer.drawer;

        this.container = 'string' == typeof params.container ?
            document.querySelector(params.container) : params.container;

        if (!this.container) {
            throw Error('No container for WaveSurfer spectrogram');
        }

        this.width = drawer.width;
        this.pixelRatio = this.params.pixelRatio || wavesurfer.params.pixelRatio;
        this.fftSamples = this.params.fftSamples || wavesurfer.params.fftSamples || 512;
        this.height = this.fftSamples / 2;

        this.createWrapper();
        this.createCanvas();
        this.render();

        wavesurfer.drawer.wrapper.onscroll = this.updateScroll.bind(this);
        wavesurfer.on('redraw', this.render.bind(this));
        wavesurfer.on('destroy', this.destroy.bind(this));
    },

    destroy: function () {
        this.unAll();
        if (this.wrapper) {
            this.wrapper.parentNode.removeChild(this.wrapper);
            this.wrapper = null;
        }
    },

    createWrapper: function () {
        var prevSpectrogram = this.container.querySelector('spectrogram');
        if (prevSpectrogram) {
            this.container.removeChild(prevSpectrogram);
        }

        var wsParams = this.wavesurfer.params;

        this.wrapper = this.container.appendChild(
            document.createElement('spectrogram')
        );
        this.drawer.style(this.wrapper, {
            display: 'block',
            position: 'relative',
            userSelect: 'none',
            webkitUserSelect: 'none',
            height: this.height + 'px'
        });

        if (wsParams.fillParent || wsParams.scrollParent) {
            this.drawer.style(this.wrapper, {
                width: '100%',
                overflowX: 'hidden',
                overflowY: 'hidden'
            });
        }

        var my = this;
        this.wrapper.addEventListener('click', function (e) {
            e.preventDefault();
            var relX = 'offsetX' in e ? e.offsetX : e.layerX;
            my.fireEvent('click', (relX / my.scrollWidth) || 0);
        });
    },

    createCanvas: function () {
        var canvas = this.canvas = this.wrapper.appendChild(
          document.createElement('canvas')
        );

        this.spectrCc = canvas.getContext('2d');

        this.wavesurfer.drawer.style(canvas, {
            position: 'absolute',
            zIndex: 4
        });
    },

    render: function () {
        this.updateCanvasStyle();

        if (this.frequenciesDataUrl) {
            this.loadFrequenciesData(this.frequenciesDataUrl);
        }
        else {
            this.getFrequencies(this.drawSpectrogram);
        }
    },

    updateCanvasStyle: function () {
        var width = Math.round(this.width / this.pixelRatio) + 'px';
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.canvas.style.width = width;
    },

    drawSpectrogram: function(frequenciesData, my) {
        var spectrCc = my.spectrCc;

        var length = my.wavesurfer.backend.getDuration();
        var height = my.height;

        var pixels = my.resample(frequenciesData);

        var heightFactor = my.buffer ? 2 / my.buffer.numberOfChannels : 1;

        for (var i = 0; i < pixels.length; i++) {
            for (var j = 0; j < pixels[i].length; j++) {
                var colorValue = 255 - pixels[i][j];
                my.spectrCc.fillStyle = 'rgb(' + colorValue + ', '  + colorValue + ', ' + colorValue + ')';
                my.spectrCc.fillRect(i, height - j * heightFactor, 1, heightFactor);
            }
        }
    },

    getFrequencies: function(callback) {
        var fftSamples = this.fftSamples;
        var buffer = this.buffer = this.wavesurfer.backend.buffer;
        var channelOne = buffer.getChannelData(0);
        var bufferLength = buffer.length;
        var sampleRate = buffer.sampleRate;
        var frequencies = [];
        var noverlap = fftSamples / 2;

        if (! buffer) {
            this.fireEvent('error', 'Web Audio buffer is not available');
            return;
        }

        var samplesPerPx = buffer.length / this.canvas.width;
        /*
        //Find the nearest power of two:
        var idealBufferSize = Math.pow(2, Math.round( Math.log(samplesPerPx) / Math.log(2)));
        //Buffer size must be within [256, 16834]
        var bufferSize = Math.min(16384, Math.max(256,idealBufferSize));
        */
        
        var fft = new FFT(fftSamples, sampleRate);

        var hannWindowValues = new Float32Array(fftSamples);
        for (var i = 0; i<fftSamples; i++) {
            hannWindowValues[i] = WindowFunction.Hann(fftSamples, i);
        }

        var maxBuffersCount = Math.floor(bufferLength/ (fftSamples - noverlap));

        var currentOffset = 0;
        var hasMoreData = true;

        for (var i=0; i<maxBuffersCount && hasMoreData; i++) {
            var segment = new Float32Array(fftSamples);
            var realValueLength = fftSamples;
            if (currentOffset + fftSamples > channelOne.length) {
                realValueLength = channelOne.length - currentOffset;
            }
            for (var j = 0; j<realValueLength; j++) {
                segment[j] = channelOne[currentOffset + j] * hannWindowValues[j];
            }
            for (; j<fftSamples; j++) {
                segment[j] = 0;
            }

            if (segment.length == fftSamples) {
                fft.forward(segment);
                var spectrum = fft.spectrum;
                var array = new Uint8Array(fftSamples/2);
                for (var j = 0; j<fftSamples/2; j++) {
                    array[j] = Math.max(-255, Math.log10(spectrum[j])*45);
                }
                frequencies.push(array);
            }
            currentOffset += (fftSamples - noverlap);
        }
        callback(frequencies, this);
    },


    loadFrequenciesData: function (url) {
        var my = this;

        var ajax = WaveSurfer.util.ajax({ url: url });

        ajax.on('success', function(data) { my.drawSpectrogram(JSON.parse(data), my); });
        ajax.on('error', function (e) {
            my.fireEvent('error', 'XHR error: ' + e.target.statusText);
        });

        return ajax;
    },

    updateScroll: function(e) {
      this.wrapper.scrollLeft = e.target.scrollLeft;
    },

    resample: function(oldMatrix, columnsNumber) {
        var columnsNumber = this.width;
        var newMatrix = [];

        var oldPiece = 1 / oldMatrix.length;
        var newPiece = 1 / columnsNumber;

        for (var i = 0; i < columnsNumber; i++) {
            var column = new Array(oldMatrix[0].length);

            for (var j = 0; j < oldMatrix.length; j++) {
                var oldStart = j * oldPiece;
                var oldEnd = oldStart + oldPiece;
                var newStart = i * newPiece;
                var newEnd = newStart + newPiece;

                var overlap = (oldEnd <= newStart || newEnd <= oldStart) ? 
                                0 :
                                Math.min(Math.max(oldEnd, newStart), Math.max(newEnd, oldStart)) -
                                Math.max(Math.min(oldEnd, newStart), Math.min(newEnd, oldStart));

                if (overlap > 0) {
                    for (var k = 0; k < oldMatrix[0].length; k++) {
                        if (column[k] == null) {
                            column[k] = 0;
                        }
                        column[k] += (overlap / newPiece) * oldMatrix[j][k];
                    }
                }
            }

            var intColumn = new Uint8Array(oldMatrix[0].length);

            for (var k = 0; k < oldMatrix[0].length; k++) {
                intColumn[k] = column[k];
            }

            newMatrix.push(intColumn);
        }

        return newMatrix;
    }
};

WaveSurfer.util.extend(WaveSurfer.Spectrogram, WaveSurfer.Observer);
