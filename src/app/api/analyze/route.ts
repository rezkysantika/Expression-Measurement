import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    
    const audioFile = formData.get('audio');

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const pythonResponse = await fetch('http://127.0.0.1:5000/api/analyze', {
      method: 'POST',
      body: formData,
    });

    if (!pythonResponse.ok) {
      const errorData = await pythonResponse.json();
      return NextResponse.json({ error: `Backend error: ${errorData.error}` }, { status: pythonResponse.status });
    }

    const data = await pythonResponse.json();
    
    return NextResponse.json(data, { status: 200 });

  } catch (error: any) {
    console.error('API Route Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}