"use client";

import React, { useState, useRef } from 'react';

type AnalysisResult = {
  emotion: string;
  confidence: number;
  breakdown: { emotion: string; percentage: number; }[];
};

const mockAnalysisResults: AnalysisResult = {
  emotion: 'Frustration',
  confidence: 0.85,
  breakdown: [
    { emotion: 'Frustration', percentage: 85 },
    { emotion: 'Neutrality', percentage: 10 },
    { emotion: 'Sadness', percentage: 5 },
  ],
};

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    setError(null);
    setAudioBlob(null);
    setAudioUrl(null);
    setAnalysisResult(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      
      mediaRecorder.current.ondataavailable = (event) => {
        audioChunks.current.push(event.data);
      };

      mediaRecorder.current.onstop = () => {
        const newAudioBlob = new Blob(audioChunks.current, { type: 'audio/wav' });
        setAudioBlob(newAudioBlob);
        setAudioUrl(URL.createObjectURL(newAudioBlob));
        audioChunks.current = [];
      };

      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Could not access microphone. Please check your browser permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setAnalysisResult(null);
    
    const file = event.target.files?.[0];
    if (file && file.type === 'audio/wav') {
      const url = URL.createObjectURL(file);
      setAudioBlob(file);
      setAudioUrl(url);
    } else {
      setError('Please upload a valid .wav audio file.');
    }
  };
  
const analyzeAudio = async () => {
    if (!audioBlob) {
      setError('Please record or upload an audio file first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setAnalysisResult(null);

    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.wav');

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      setAnalysisResult(result);

    } catch (err: any) {
      setError(`An error occurred during analysis: ${err.message}`);
      console.error('Analysis error:', err);
    } finally {
      setIsLoading(false);
    }
};

//   const analyzeAudio = async () => {
//     if (!audioBlob) {
//       setError('Please record or upload an audio file first.');
//       return;
//     }

//     setIsLoading(true);
//     setError(null);
//     setAnalysisResult(null);

//     try {
//       // Simulate API request delay
//       await new Promise(resolve => setTimeout(resolve, 2000));
      
//       // Simulate receiving analysis results
//       setAnalysisResult(mockAnalysisResults);
//     } catch (err) {
//       setError('An error occurred during analysis.');
//       console.error('Analysis error:', err);
//     } finally {
//       setIsLoading(false);
//     }
//   };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-8">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl p-12 text-center">
        <h1 className="text-xl font-extrabold text-gray-800 mb-12">Speech Emotion Recognition</h1>

        <div className="flex flex-col items-center">
          {isRecording ? (
            <button
              onClick={stopRecording}
              className="w-24 h-24 flex items-center justify-center rounded-full bg-red-500 text-white shadow-md transform transition-all duration-300 hover:scale-105 animate-pulse"
            >
              <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h12v12H6z" /></svg>
            </button>
          ) : (
            <button
              onClick={startRecording}
              className="w-24 h-24 flex items-center justify-center rounded-full bg-blue-600 text-white shadow-md transform transition-all duration-300 hover:scale-105"
            >
              <svg className="w-12 h-12" fill="currentColor" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
            </button>
          )}
          <p className="mt-4 text-gray-600 text-lg font-medium">Click to record your voice</p>
        </div>

        <div className="my-8 text-center">
          <span className="text-gray-400 font-semibold uppercase tracking-wide">OR</span>
        </div>

        <div className="flex justify-center mb-12">
          <label htmlFor="file-upload" className="block cursor-pointer">
            <span className="inline-flex items-center px-6 py-3 border border-gray-300 rounded-full shadow-sm text-lg font-medium text-blue-600 bg-white hover:bg-gray-50 transition-colors">
              <svg className="w-6 h-6 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
              Upload .wav File
            </span>
            <input
              id="file-upload"
              type="file"
              accept=".wav"
              onChange={handleFileUpload}
              className="sr-only"
              disabled={isRecording}
            />
          </label>
        </div>
        
        {audioUrl && (
          <div className="mb-8 p-4 bg-gray-100 rounded-lg">
            <h3 className="text-md font-semibold text-gray-700 mb-2">Recorded Audio</h3>
            <audio controls src={audioUrl} className="w-full"></audio>
          </div>
        )}

        <button
          onClick={analyzeAudio}
          disabled={!audioBlob || isLoading || isRecording}
          className="w-full bg-indigo-600 text-white font-bold py-4 px-6 rounded-full shadow-lg transform transition-all duration-300 hover:scale-105 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-xl"
        >
          {isLoading ? (
            <div className="flex items-center justify-center">
              <svg className="animate-spin h-6 w-6 mr-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
              Analyzing...
            </div>
          ) : (
            "Analyze Emotion"
          )}
        </button>

        {error && (
          <p className="mt-4 text-red-500 text-sm text-center">{error}</p>
        )}

        {analysisResult && (
          <div className="mt-8 p-6 bg-gray-100 rounded-lg">
            <h3 className="text-xl font-bold mb-4 text-green-600">Analysis Results</h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center text-lg">
                <span className="font-semibold text-gray-700">Dominant Emotion:</span>
                <span className="font-bold text-green-600">{analysisResult.emotion}</span>
              </div>
              <div className="flex justify-between items-center text-lg">
                <span className="font-semibold text-gray-700">Confidence:</span>
                <span className="font-bold text-green-600">{Math.round(analysisResult.confidence * 100)}%</span>
              </div>
              <div>
                <h4 className="font-semibold mt-4 mb-2 text-gray-500">Emotional Breakdown:</h4>
                <div className="space-y-2">
                  {analysisResult.breakdown.map((item, index) => (
                    <div key={index} className="flex items-center">
                      <span className="w-32 text-gray-600">{item.emotion}</span>
                      <div className="flex-1 bg-gray-300 rounded-full h-4">
                        <div
                          className="bg-green-500 rounded-full h-4 transition-all duration-500 ease-out"
                          style={{ width: `${item.percentage}%` }}
                        ></div>
                      </div>
                      <span className="ml-3 text-sm text-gray-600">{item.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
